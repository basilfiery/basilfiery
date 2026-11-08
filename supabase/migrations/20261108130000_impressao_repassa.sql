-- Vários computadores com o BasilFiery aberto: se o que pegou a conta não tem a impressora
-- (ou ela falhou), o pedido volta para a fila e outro computador imprime. Quem falhou não pega de novo.
alter table public.fila_impressao add column if not exists falharam text[] not null default '{}';

drop function if exists public.impressao_reivindicar(uuid, text);
create or replace function public.impressao_reivindicar(p_id uuid, p_aparelho text default null, p_dispositivo text default null)
returns boolean language plpgsql security definer set search_path to '' as $function$
declare v_ok boolean;
begin
  update public.fila_impressao
     set pego_em = now(),
         pego_por = left(coalesce(p_aparelho, 'Computador do caixa'), 80),
         tentativas = tentativas + 1,
         impresso_em = case when p_aparelho is null then now() else null end
   where id = p_id and impresso_em is null and public.eh_membro(restaurante_id)
     and (pego_em is null or pego_em < now() - interval '40 seconds')
     and (p_dispositivo is null or not (p_dispositivo = any(falharam)))
  returning true into v_ok;
  return coalesce(v_ok, false);
end $function$;
revoke all on function public.impressao_reivindicar(uuid, text, text) from public, anon;
grant execute on function public.impressao_reivindicar(uuid, text, text) to authenticated;

drop function if exists public.impressao_concluir(uuid, text);
create or replace function public.impressao_concluir(p_id uuid, p_erro text default null, p_dispositivo text default null)
returns void language plpgsql security definer set search_path to '' as $function$
begin
  update public.fila_impressao
     set impresso_em = case when p_erro is null then now() else null end,
         erro = left(p_erro, 300),
         -- Falhou: solta para outro computador tentar
         pego_em = case when p_erro is null then pego_em else null end,
         falharam = case when p_erro is not null and p_dispositivo is not null and not (p_dispositivo = any(falharam))
                          then array_append(falharam, left(p_dispositivo, 64)) else falharam end
   where id = p_id and impresso_em is null and public.eh_membro(restaurante_id);
end $function$;
revoke all on function public.impressao_concluir(uuid, text, text) from public, anon;
grant execute on function public.impressao_concluir(uuid, text, text) to authenticated;
