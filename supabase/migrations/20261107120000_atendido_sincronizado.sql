-- "Atendido" igual em todo lugar: o garçom confirmar o pedido novo põe o pedido em preparo
-- (o painel para de tocar e tira o aviso), e o painel tirar do "novo" também apaga o alerta no app do garçom.
create or replace function public.pedido_garcom_atendido(p_pedido uuid)
 returns void language plpgsql security definer set search_path to '' as $function$
declare v_rest uuid;
begin
  select restaurante_id into v_rest from public.pedidos where id = p_pedido;
  if v_rest is null or not public.eh_membro(v_rest) then raise exception 'Pedido não encontrado'; end if;
  update public.pedidos
     set garcom_atendido_em = coalesce(garcom_atendido_em, now()),
         status = case when status = 'novo' then 'preparando'::public.status_pedido else status end,
         atualizado_em = case when status = 'novo' then now() else atualizado_em end
   where id = p_pedido;
end $function$;

create or replace function privado.pedido_saiu_do_novo() returns trigger language plpgsql set search_path to '' as $$
begin
  if old.status = 'novo' and new.status <> 'novo' and new.garcom_atendido_em is null then
    new.garcom_atendido_em := now();
  end if;
  return new;
end $$;
drop trigger if exists pedido_saiu_do_novo on public.pedidos;
create trigger pedido_saiu_do_novo before update of status on public.pedidos
  for each row execute function privado.pedido_saiu_do_novo();
