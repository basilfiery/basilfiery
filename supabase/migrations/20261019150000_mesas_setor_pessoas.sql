-- Painel de mesas: setor (Salão, Varanda…) e quantidade de pessoas na mesa
alter table public.mesas add column if not exists setor text check (setor is null or char_length(setor) <= 40);
alter table public.mesas add column if not exists pessoas smallint check (pessoas is null or pessoas between 1 and 99);
grant select (setor, pessoas), insert (setor), update (setor) on public.mesas to authenticated;

-- Qualquer pessoa da equipe (garçom, caixa…) informa quantas pessoas estão na mesa
create or replace function public.mesa_definir_pessoas(p_mesa uuid, p_pessoas int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_rest uuid;
begin
  select restaurante_id into v_rest from public.mesas where id = p_mesa;
  if v_rest is null or not public.eh_membro(v_rest) then raise exception 'Mesa não encontrada'; end if;
  update public.mesas set pessoas = case when p_pessoas between 1 and 99 then p_pessoas end where id = p_mesa;
end $$;
revoke execute on function public.mesa_definir_pessoas(uuid, int) from public;
grant execute on function public.mesa_definir_pessoas(uuid, int) to authenticated;

CREATE OR REPLACE FUNCTION public.mesa_fechar_conta(p_mesa uuid, p_forma text DEFAULT 'outro'::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_mesa public.mesas;
  v_caixa uuid;
  v_total numeric;
  v_pag uuid;
begin
  select * into v_mesa from public.mesas where id = p_mesa;
  if not found or not public.tem_papel(v_mesa.restaurante_id, '{dono,gerente,caixa}') then
    raise exception 'Sem permissão para fechar contas';
  end if;
  if p_forma not in ('dinheiro', 'pix', 'credito', 'debito', 'outro') then raise exception 'Forma de pagamento inválida'; end if;

  select id into v_caixa from public.caixas where restaurante_id = v_mesa.restaurante_id and fechado_em is null;
  if v_caixa is null then raise exception 'Abra o caixa antes de receber pagamentos'; end if;

  select coalesce(sum(total), 0) into v_total
  from public.pedidos where mesa_id = p_mesa and pago_em is null and status <> 'cancelado';

  if v_total > 0 then
    insert into public.pagamentos (restaurante_id, caixa_id, mesa_id, mesa_nome, forma, valor)
    values (v_mesa.restaurante_id, v_caixa, v_mesa.id, v_mesa.nome, p_forma, v_total)
    returning id into v_pag;
  end if;

  update public.pedidos set pago_em = now(), pagamento_id = case when status = 'cancelado' then null else v_pag end
  where mesa_id = p_mesa and pago_em is null;
  update public.chamados set atendido_em = now() where mesa_id = p_mesa and atendido_em is null;
  update public.mesa_acessos set status = 'encerrado', respondido_em = now()
  where mesa_id = p_mesa and status in ('liberado', 'pendente') and not fixo;
  -- Mesa livre de novo: zera a quantidade de pessoas
  update public.mesas set pessoas = null where id = p_mesa;
  return v_total;
end $function$;
