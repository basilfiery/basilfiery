-- Conta pedida pelo garçom: só vale como "impressa" quando a impressora confirma.
-- Antes, o computador marcava impressa ANTES de imprimir: se a impressora falhasse, ninguém ficava sabendo.
alter table public.fila_impressao
  add column if not exists pego_em timestamptz,
  add column if not exists pego_por text,
  add column if not exists erro text,
  add column if not exists tentativas int not null default 0;

-- Um computador pega o pedido de impressão (se outro pegou e sumiu há mais de 40 s, pode pegar de novo).
-- Sem p_aparelho (versão antiga do painel aberta): continua marcando como impressa na hora.
drop function if exists public.impressao_reivindicar(uuid);
create or replace function public.impressao_reivindicar(p_id uuid, p_aparelho text default null)
returns boolean language plpgsql security definer set search_path to '' as $function$
declare v_ok boolean;
begin
  update public.fila_impressao
     set pego_em = now(),
         pego_por = left(coalesce(p_aparelho, 'Computador do caixa'), 80),
         erro = null,
         tentativas = tentativas + 1,
         impresso_em = case when p_aparelho is null then now() else null end
   where id = p_id and impresso_em is null and public.eh_membro(restaurante_id)
     and (pego_em is null or pego_em < now() - interval '40 seconds')
  returning true into v_ok;
  return coalesce(v_ok, false);
end $function$;
revoke all on function public.impressao_reivindicar(uuid, text) from public, anon;
grant execute on function public.impressao_reivindicar(uuid, text) to authenticated;

-- Resultado de verdade: impressa, ou o erro da impressora (o garçom vê na hora)
create or replace function public.impressao_concluir(p_id uuid, p_erro text default null)
returns void language plpgsql security definer set search_path to '' as $function$
begin
  update public.fila_impressao
     set impresso_em = case when p_erro is null then now() else null end,
         erro = left(p_erro, 300),
         pego_em = case when p_erro is null then pego_em else null end
   where id = p_id and impresso_em is null and public.eh_membro(restaurante_id);
end $function$;
revoke all on function public.impressao_concluir(uuid, text) from public, anon;
grant execute on function public.impressao_concluir(uuid, text) to authenticated;
