alter table public.products
  add column held integer not null default 0;

alter table public.products
  add constraint products_held_nonnegative check (held >= 0);

-- Open requests that already overlap stay reserved up to the units that exist.
update public.products p
set held = least(p.stock, r.qty)
from (
  select ii.product_id, sum(ii.quantity_requested)::integer as qty
  from public.inquiry_items ii
  join public.inquiries i on i.id = ii.inquiry_id
  where i.status in ('nueva', 'en_contacto')
    and ii.product_id is not null
  group by ii.product_id
) r
where p.id = r.product_id;

alter table public.products
  add constraint products_held_within_stock check (held <= stock);

alter table public.products
  add column available integer generated always as (stock - held) stored;

create index products_available_idx on public.products (available);

grant select (available) on public.products to anon;

drop policy products_public_read on public.products;

create policy products_public_read
on public.products
for select
to anon
using (available > 0);

create or replace function private.refresh_held(p_product_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.products p
  set held = least(p.stock, coalesce((
    select sum(ii.quantity_requested)::integer
    from public.inquiry_items ii
    join public.inquiries i on i.id = ii.inquiry_id
    where ii.product_id = p.id
      and i.status in ('nueva', 'en_contacto')
  ), 0))
  where p.id = p_product_id;
$$;

revoke all on function private.refresh_held(uuid) from public;
grant execute on function private.refresh_held(uuid) to authenticated;

create or replace function private.create_inquiry(
  p_name text,
  p_company text,
  p_email text,
  p_phone text,
  p_note text,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  item jsonb;
  v_product public.products;
  v_qty integer;
  v_product_id uuid;
begin
  if p_name is null or length(btrim(p_name)) = 0 or length(btrim(p_name)) > 120 then
    raise exception 'El nombre es obligatorio';
  end if;
  if p_email is null or position('@' in p_email) = 0 or length(btrim(p_email)) > 200 then
    raise exception 'El correo no es válido';
  end if;
  if p_phone is null or length(btrim(p_phone)) < 8 or length(btrim(p_phone)) > 40 then
    raise exception 'El teléfono es obligatorio';
  end if;
  if p_company is not null and length(btrim(p_company)) > 160 then
    raise exception 'La empresa es demasiado larga';
  end if;
  if p_note is not null and length(p_note) > 2000 then
    raise exception 'La nota es demasiado larga';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos una pieza';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'Demasiadas piezas en una sola solicitud';
  end if;

  insert into public.inquiries (name, company, email, phone, note)
  values (
    btrim(p_name),
    nullif(btrim(coalesce(p_company, '')), ''),
    btrim(p_email),
    btrim(p_phone),
    nullif(btrim(coalesce(p_note, '')), '')
  )
  returning id into v_id;

  for item in
    select value
    from jsonb_array_elements(p_items)
    order by value ->> 'product_id'
  loop
    v_qty := (item ->> 'quantity')::integer;
    v_product_id := (item ->> 'product_id')::uuid;

    if v_qty is null or v_qty < 1 then
      raise exception 'Cantidad inválida';
    end if;

    select * into v_product
    from public.products
    where id = v_product_id
    for update;

    if not found or v_product.sale_price is null or (v_product.stock - v_product.held) < v_qty then
      raise exception 'Una pieza ya no tiene stock suficiente';
    end if;

    if exists (
      select 1
      from public.inquiry_items
      where inquiry_id = v_id and product_id = v_product.id
    ) then
      raise exception 'Hay una pieza repetida en la lista';
    end if;

    insert into public.inquiry_items (
      inquiry_id,
      product_id,
      brand,
      model,
      quantity_requested,
      sale_price
    ) values (
      v_id,
      v_product.id,
      v_product.brand,
      v_product.model,
      v_qty,
      v_product.sale_price
    );

    perform private.refresh_held(v_product.id);
  end loop;

  return v_id;
end;
$$;

create or replace function public.release_inquiry(p_inquiry_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status public.inquiry_status;
  v_product_id uuid;
begin
  if not private.is_admin() then
    raise exception 'No autorizado';
  end if;

  select status into v_status
  from public.inquiries
  where id = p_inquiry_id
  for update;

  if v_status is null then
    raise exception 'Solicitud no encontrada';
  end if;
  if v_status = 'surtida' then
    raise exception 'Esta solicitud ya fue surtida';
  end if;
  if v_status = 'cancelada' then
    raise exception 'Esta solicitud está cancelada';
  end if;

  for v_product_id in
    select distinct product_id
    from public.inquiry_items
    where inquiry_id = p_inquiry_id
      and product_id is not null
    order by product_id
  loop
    perform 1
    from public.products
    where id = v_product_id
    for update;
  end loop;

  update public.inquiries
  set status = 'cancelada'
  where id = p_inquiry_id;

  for v_product_id in
    select distinct product_id
    from public.inquiry_items
    where inquiry_id = p_inquiry_id
      and product_id is not null
    order by product_id
  loop
    perform private.refresh_held(v_product_id);
  end loop;
end;
$$;

revoke all on function public.release_inquiry(uuid) from public;
grant execute on function public.release_inquiry(uuid) to authenticated;

create or replace function public.dispatch_quote(p_quote_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status public.quote_status;
  v_inquiry_id uuid;
  v_inquiry_status public.inquiry_status;
  v_product_id uuid;
  v_quote_qty integer;
  v_this_qty integer;
  v_stock integer;
  v_held integer;
  v_claim integer;
begin
  if not private.is_admin() then
    raise exception 'No autorizado';
  end if;

  select status, inquiry_id into v_status, v_inquiry_id
  from public.quotes
  where id = p_quote_id
  for update;

  if v_status is null then
    raise exception 'Cotización no encontrada';
  end if;
  if v_status = 'despachada' then
    raise exception 'Esta cotización ya fue despachada';
  end if;

  if not exists (select 1 from public.quote_items where quote_id = p_quote_id) then
    raise exception 'Agrega al menos una pieza';
  end if;

  if exists (
    select 1
    from public.quote_items
    where quote_id = p_quote_id and product_id is null
  ) then
    raise exception 'No se puede despachar una pieza que ya no existe';
  end if;

  if v_inquiry_id is not null then
    select status into v_inquiry_status
    from public.inquiries
    where id = v_inquiry_id
    for update;

    if v_inquiry_status is null then
      v_inquiry_id := null;
    elsif v_inquiry_status = 'cancelada' then
      raise exception 'Esta solicitud fue devuelta al catálogo';
    elsif v_inquiry_status = 'surtida' then
      raise exception 'Esta solicitud ya fue surtida';
    end if;
  end if;

  for v_product_id in
    select product_id
    from (
      select product_id from public.quote_items where quote_id = p_quote_id
      union
      select product_id
      from public.inquiry_items
      where inquiry_id = v_inquiry_id and product_id is not null
    ) ids
    order by product_id
  loop
    perform 1 from public.products where id = v_product_id for update;
  end loop;

  for v_product_id, v_quote_qty in
    select product_id, sum(quantity)::integer
    from public.quote_items
    where quote_id = p_quote_id
    group by product_id
    order by product_id
  loop
    select stock, held into v_stock, v_held
    from public.products
    where id = v_product_id;

    v_this_qty := 0;
    if v_inquiry_id is not null then
      select coalesce(sum(quantity_requested), 0)::integer into v_this_qty
      from public.inquiry_items
      where inquiry_id = v_inquiry_id and product_id = v_product_id;
    end if;

    v_claim := least(v_this_qty, v_held);
    if v_quote_qty > v_stock - (v_held - v_claim) then
      raise exception 'No hay stock suficiente';
    end if;
  end loop;

  if v_inquiry_id is not null then
    update public.inquiries
    set status = 'surtida'
    where id = v_inquiry_id;
  end if;

  update public.products p
  set
    stock = p.stock - q.qty,
    held = least(p.stock - q.qty, coalesce((
      select sum(ii.quantity_requested)::integer
      from public.inquiry_items ii
      join public.inquiries i on i.id = ii.inquiry_id
      where ii.product_id = p.id
        and i.status in ('nueva', 'en_contacto')
    ), 0))
  from (
    select product_id, sum(quantity)::integer as qty
    from public.quote_items
    where quote_id = p_quote_id
    group by product_id
  ) q
  where p.id = q.product_id;

  if v_inquiry_id is not null then
    for v_product_id in
      select distinct ii.product_id
      from public.inquiry_items ii
      where ii.inquiry_id = v_inquiry_id
        and ii.product_id is not null
        and not exists (
          select 1
          from public.quote_items qi
          where qi.quote_id = p_quote_id and qi.product_id = ii.product_id
        )
      order by ii.product_id
    loop
      perform private.refresh_held(v_product_id);
    end loop;
  end if;

  update public.quotes
  set status = 'despachada'
  where id = p_quote_id;
end;
$$;
