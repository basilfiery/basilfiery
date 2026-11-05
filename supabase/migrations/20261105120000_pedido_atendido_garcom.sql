-- Garçom marca "Atendido" no pedido novo da mesa (viu o pedido): a mesa para de piscar no app do garçom.
alter table public.pedidos add column if not exists garcom_atendido_em timestamptz;

create or replace function public.pedido_garcom_atendido(p_pedido uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_rest uuid;
begin
  select restaurante_id into v_rest from public.pedidos where id = p_pedido;
  if v_rest is null or not public.eh_membro(v_rest) then raise exception 'Pedido não encontrado'; end if;
  update public.pedidos set garcom_atendido_em = coalesce(garcom_atendido_em, now()) where id = p_pedido;
end $$;
revoke execute on function public.pedido_garcom_atendido(uuid) from public;
grant execute on function public.pedido_garcom_atendido(uuid) to authenticated;
