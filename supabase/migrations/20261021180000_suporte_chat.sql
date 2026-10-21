-- Chat de suporte (igual ao balãozinho do Anota AI): a equipe da loja fala com o suporte
-- do BasilFiery pelo painel; o suporte responde em /plataforma › Suporte.

create table if not exists public.suporte_mensagens (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  autor_id uuid default auth.uid(),
  autor_nome text not null default '',
  do_suporte boolean not null default false,
  texto text not null check (length(btrim(texto)) between 1 and 2000),
  criado_em timestamptz not null default now(),
  lida_em timestamptz
);
create index if not exists suporte_mensagens_rest_idx on public.suporte_mensagens (restaurante_id, criado_em);
create index if not exists suporte_mensagens_nao_lidas_idx on public.suporte_mensagens (do_suporte) where lida_em is null;

alter table public.suporte_mensagens enable row level security;
revoke all on public.suporte_mensagens from anon;
revoke insert, update, delete on public.suporte_mensagens from authenticated;
grant select on public.suporte_mensagens to authenticated;

drop policy if exists "ver suporte da loja" on public.suporte_mensagens;
create policy "ver suporte da loja" on public.suporte_mensagens for select to authenticated
  using (public.eh_membro(restaurante_id));

do $$ begin
  alter publication supabase_realtime add table public.suporte_mensagens;
exception when duplicate_object then null; end $$;

-- Envia uma mensagem. p_como_suporte = true só para o administrador da plataforma.
create or replace function public.suporte_enviar(p_rest uuid, p_texto text, p_como_suporte boolean default false)
returns public.suporte_mensagens
language plpgsql security definer set search_path = '' as $$
declare
  v_nome text;
  v_msg public.suporte_mensagens;
begin
  if p_como_suporte then
    if not public.eh_admin_plataforma() then raise exception 'Só o suporte pode responder por aqui.'; end if;
    v_nome := 'Suporte';
  else
    select nullif(btrim(m.nome), '') into v_nome from public.membros m
      where m.restaurante_id = p_rest and m.user_id = (select auth.uid());
    if not found and not public.eh_admin_plataforma() then raise exception 'Sem acesso a esta loja.'; end if;
  end if;
  if length(btrim(coalesce(p_texto, ''))) = 0 then raise exception 'Escreva uma mensagem.'; end if;

  insert into public.suporte_mensagens (restaurante_id, autor_id, autor_nome, do_suporte, texto)
  values (p_rest, (select auth.uid()), coalesce(v_nome, ''), p_como_suporte, left(btrim(p_texto), 2000))
  returning * into v_msg;
  return v_msg;
end $$;

-- Marca como lidas as mensagens do outro lado da conversa.
create or replace function public.suporte_ler(p_rest uuid, p_como_suporte boolean default false)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_como_suporte and not public.eh_admin_plataforma() then return; end if;
  if not p_como_suporte and not public.eh_membro(p_rest) then return; end if;
  update public.suporte_mensagens set lida_em = now()
    where restaurante_id = p_rest and do_suporte = not p_como_suporte and lida_em is null;
end $$;

-- Caixa de entrada do suporte: uma linha por loja, a mais recente primeiro.
create or replace function public.suporte_conversas()
returns table (restaurante_id uuid, nome text, logo_url text, cor text, plano text,
               ultima_texto text, ultima_em timestamptz, ultima_do_suporte boolean, nao_lidas int)
language sql stable security definer set search_path = '' as $$
  select r.id, r.nome, r.logo_url, r.cor, r.plano,
         u.texto, u.criado_em, u.do_suporte,
         (select count(*)::int from public.suporte_mensagens x
           where x.restaurante_id = r.id and not x.do_suporte and x.lida_em is null)
  from public.restaurantes r
  join lateral (select m.texto, m.criado_em, m.do_suporte from public.suporte_mensagens m
                where m.restaurante_id = r.id order by m.criado_em desc limit 1) u on true
  where public.eh_admin_plataforma()
  order by u.criado_em desc
$$;

revoke all on function public.suporte_enviar(uuid, text, boolean) from public, anon;
revoke all on function public.suporte_ler(uuid, boolean) from public, anon;
revoke all on function public.suporte_conversas() from public, anon;
grant execute on function public.suporte_enviar(uuid, text, boolean) to authenticated;
grant execute on function public.suporte_ler(uuid, boolean) to authenticated;
grant execute on function public.suporte_conversas() to authenticated;
