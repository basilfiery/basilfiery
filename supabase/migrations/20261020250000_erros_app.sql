-- Registro de erros das telas (para descobrir e corrigir qualquer falha que aconteça no uso real)
create table if not exists public.erros_app (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  user_id uuid,
  url text,
  mensagem text,
  pilha text,
  componente text,
  tipo text,
  agente text,
  versao text
);
create index if not exists erros_app_criado on public.erros_app (criado_em desc);
alter table public.erros_app enable row level security;
revoke all on public.erros_app from anon, authenticated;
drop policy if exists erros_app_admin on public.erros_app;
create policy erros_app_admin on public.erros_app for select to authenticated using (public.eh_admin_plataforma());
grant select on public.erros_app to authenticated;

create or replace function public.registrar_erro(p_url text, p_mensagem text, p_pilha text default null, p_componente text default null,
  p_tipo text default null, p_agente text default null, p_versao text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  -- Proteção contra enxurrada: no máximo 300 registros por minuto no sistema todo
  if (select count(*) from public.erros_app where criado_em > now() - interval '1 minute') >= 300 then return; end if;
  insert into public.erros_app (user_id, url, mensagem, pilha, componente, tipo, agente, versao)
  values (auth.uid(), left(p_url, 300), left(p_mensagem, 1000), left(p_pilha, 4000), left(p_componente, 3000), left(p_tipo, 40), left(p_agente, 300), left(p_versao, 40));
end $$;
revoke all on function public.registrar_erro(text, text, text, text, text, text, text) from public;
grant execute on function public.registrar_erro(text, text, text, text, text, text, text) to anon, authenticated;

-- Limpa registros com mais de 60 dias (todo dia)
select cron.unschedule('limpar-erros-app') where exists (select 1 from cron.job where jobname = 'limpar-erros-app');
select cron.schedule('limpar-erros-app', '30 4 * * *', $$delete from public.erros_app where criado_em < now() - interval '60 days'$$);
