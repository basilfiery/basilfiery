-- Fechar mesa sem pedido: o cliente abriu a mesa (QR code) e foi embora sem pedir.
-- Desconecta os celulares (menos tablet fixo), atende os chamados e limpa cliente e pessoas.
-- Só vale para mesa sem pedido em aberto (com pedido, a conta é fechada pelo caixa).
create or replace function public.mesa_liberar(p_mesa uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_mesa public.mesas;
begin
  select * into v_mesa from public.mesas where id = p_mesa;
  if not found or not public.eh_membro(v_mesa.restaurante_id) then raise exception 'Mesa não encontrada'; end if;
  if exists (select 1 from public.pedidos where mesa_id = p_mesa and pago_em is null and status <> 'cancelado') then
    raise exception 'Esta mesa tem pedido em aberto. Feche a conta no caixa.';
  end if;
  update public.mesa_acessos set status = 'encerrado', respondido_em = now()
  where mesa_id = p_mesa and status in ('liberado', 'pendente') and not fixo;
  update public.chamados set atendido_em = now() where mesa_id = p_mesa and atendido_em is null;
  update public.mesas set pessoas = null, cliente_nome = null, cliente_telefone = null where id = p_mesa;
end $$;
revoke execute on function public.mesa_liberar(uuid) from public;
grant execute on function public.mesa_liberar(uuid) to authenticated;
