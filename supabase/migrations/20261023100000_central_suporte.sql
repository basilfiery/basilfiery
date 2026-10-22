-- Central de suporte (hq.basilfiery.com.br):
--   * time de suporte (atendentes) além do administrador
--   * imagem e áudio no chat, nos dois lados
--   * assistente virtual (Claude) responde primeiro; passa para uma pessoa quando precisa
--   * atendimento finalizado → o cliente avalia (1 a 5 estrelas)

-- ---------- Time de suporte ----------
create table if not exists public.plataforma_atendentes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 1 and 60),
  criado_em timestamptz not null default now()
);
alter table public.plataforma_atendentes enable row level security;
revoke all on public.plataforma_atendentes from anon, authenticated;
grant select on public.plataforma_atendentes to authenticated;
drop policy if exists "atendente vê o time" on public.plataforma_atendentes;
create policy "atendente vê o time" on public.plataforma_atendentes for select to authenticated
  using (user_id = (select auth.uid()) or public.eh_admin_plataforma());

create or replace function public.eh_atendente() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.eh_admin_plataforma() or exists (select 1 from public.plataforma_atendentes where user_id = (select auth.uid()));
$$;
grant execute on function public.eh_atendente() to authenticated;

create or replace function public.suporte_atendentes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.eh_admin_plataforma() then raise exception 'Só o administrador'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'nome', a.nome, 'email', u.email, 'criado_em', a.criado_em) order by a.nome)
    from public.plataforma_atendentes a join auth.users u on u.id = a.user_id), '[]'::jsonb);
end $$;

create or replace function public.suporte_atendente_adicionar(p_email text, p_nome text) returns void
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if not public.eh_admin_plataforma() then raise exception 'Só o administrador'; end if;
  select id into v from auth.users where lower(email) = lower(trim(p_email));
  if v is null then raise exception 'Não existe conta com esse e-mail. Peça para a pessoa criar o acesso primeiro.'; end if;
  insert into public.plataforma_atendentes (user_id, nome) values (v, coalesce(nullif(trim(p_nome), ''), split_part(p_email, '@', 1)))
  on conflict (user_id) do update set nome = excluded.nome;
end $$;

create or replace function public.suporte_atendente_remover(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.eh_admin_plataforma() then raise exception 'Só o administrador'; end if;
  delete from public.plataforma_atendentes where user_id = p_user;
end $$;

-- ---------- Mensagens: tipos, anexos e assistente ----------
alter table public.suporte_mensagens drop constraint if exists suporte_mensagens_texto_check;
alter table public.suporte_mensagens
  add column if not exists tipo text not null default 'texto',
  add column if not exists anexo text,
  add column if not exists duracao int,
  add column if not exists ia boolean not null default false,
  add column if not exists meta jsonb;
alter table public.suporte_mensagens drop constraint if exists suporte_mensagens_tipo_check;
alter table public.suporte_mensagens add constraint suporte_mensagens_tipo_check check (
  tipo in ('texto', 'imagem', 'audio', 'sistema')
  and char_length(texto) <= 4000
  and (tipo <> 'texto' or char_length(btrim(texto)) >= 1)
  and (tipo not in ('imagem', 'audio') or anexo is not null)
);

drop policy if exists "ver suporte da loja" on public.suporte_mensagens;
create policy "ver suporte da loja" on public.suporte_mensagens for select to authenticated
  using (public.eh_membro(restaurante_id) or public.eh_atendente());

-- ---------- Estado da conversa (assistente ou pessoa) ----------
create table if not exists public.suporte_estado (
  restaurante_id uuid primary key references public.restaurantes(id) on delete cascade,
  modo text not null default 'ia' check (modo in ('ia', 'humano')),
  pedido_humano_em timestamptz,
  atendente_id uuid,
  atendente_nome text,
  atualizado_em timestamptz not null default now()
);
alter table public.suporte_estado enable row level security;
revoke all on public.suporte_estado from anon, authenticated;
grant select on public.suporte_estado to authenticated;
drop policy if exists "ver estado do suporte" on public.suporte_estado;
create policy "ver estado do suporte" on public.suporte_estado for select to authenticated
  using (public.eh_membro(restaurante_id) or public.eh_atendente());
do $$ begin alter publication supabase_realtime add table public.suporte_estado; exception when duplicate_object then null; end $$;

-- ---------- Avaliações ----------
create table if not exists public.suporte_avaliacoes (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  mensagem_id uuid not null unique references public.suporte_mensagens(id) on delete cascade,
  atendente_id uuid,
  atendente_nome text,
  nota int not null check (nota between 1 and 5),
  comentario text check (comentario is null or char_length(comentario) <= 500),
  criado_em timestamptz not null default now()
);
alter table public.suporte_avaliacoes enable row level security;
revoke all on public.suporte_avaliacoes from anon, authenticated;
grant select on public.suporte_avaliacoes to authenticated;
drop policy if exists "ver avaliações" on public.suporte_avaliacoes;
create policy "ver avaliações" on public.suporte_avaliacoes for select to authenticated
  using (public.eh_membro(restaurante_id) or public.eh_atendente());

-- ---------- Funções do chat ----------
drop function if exists public.suporte_enviar(uuid, text, boolean);
create or replace function public.suporte_enviar(p_rest uuid, p_texto text, p_como_suporte boolean default false,
  p_tipo text default 'texto', p_anexo text default null, p_duracao int default null)
returns public.suporte_mensagens
language plpgsql security definer set search_path = '' as $$
declare
  v_nome text;
  v_msg public.suporte_mensagens;
begin
  if p_tipo not in ('texto', 'imagem', 'audio') then raise exception 'Tipo inválido'; end if;
  if p_anexo is not null and split_part(p_anexo, '/', 1) <> p_rest::text then raise exception 'Anexo inválido'; end if;
  if p_como_suporte then
    if not public.eh_atendente() then raise exception 'Só o time de suporte pode responder por aqui.'; end if;
    select nome into v_nome from public.plataforma_atendentes where user_id = (select auth.uid());
    v_nome := coalesce(v_nome, 'Suporte');
  else
    select nullif(btrim(m.nome), '') into v_nome from public.membros m where m.restaurante_id = p_rest and m.user_id = (select auth.uid());
    if not found and not public.eh_admin_plataforma() then raise exception 'Sem acesso a esta loja.'; end if;
  end if;
  if p_tipo = 'texto' and length(btrim(coalesce(p_texto, ''))) = 0 then raise exception 'Escreva uma mensagem.'; end if;

  insert into public.suporte_mensagens (restaurante_id, autor_id, autor_nome, do_suporte, texto, tipo, anexo, duracao)
  values (p_rest, (select auth.uid()), coalesce(v_nome, ''), p_como_suporte, left(btrim(coalesce(p_texto, '')), 4000), p_tipo, p_anexo,
          case when p_tipo = 'audio' then least(greatest(coalesce(p_duracao, 0), 0), 900) end)
  returning * into v_msg;

  -- Uma pessoa do time respondeu: a conversa passa a ser com ela (o assistente para de responder)
  if p_como_suporte then
    insert into public.suporte_estado (restaurante_id, modo, atendente_id, atendente_nome, atualizado_em)
    values (p_rest, 'humano', (select auth.uid()), v_nome, now())
    on conflict (restaurante_id) do update set modo = 'humano', atendente_id = excluded.atendente_id, atendente_nome = excluded.atendente_nome, atualizado_em = now();
  end if;
  return v_msg;
end $$;

-- Cliente pede para falar com uma pessoa
create or replace function public.suporte_pedir_humano(p_rest uuid, p_motivo text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.eh_membro(p_rest) then raise exception 'Sem acesso a esta loja.'; end if;
  insert into public.suporte_estado (restaurante_id, modo, pedido_humano_em, atualizado_em)
  values (p_rest, 'humano', now(), now())
  on conflict (restaurante_id) do update set modo = 'humano', pedido_humano_em = coalesce(public.suporte_estado.pedido_humano_em, now()), atualizado_em = now();
  insert into public.suporte_mensagens (restaurante_id, autor_id, autor_nome, do_suporte, texto, tipo, meta)
  values (p_rest, (select auth.uid()), '', false, coalesce(nullif(left(trim(p_motivo), 300), ''), 'Pediu para falar com uma pessoa do time'), 'sistema', jsonb_build_object('acao', 'pediu_humano'));
end $$;

-- Atendente finaliza: o cliente recebe o pedido de avaliação e o assistente volta a responder
create or replace function public.suporte_finalizar(p_rest uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_nome text;
begin
  if not public.eh_atendente() then raise exception 'Só o time de suporte'; end if;
  select nome into v_nome from public.plataforma_atendentes where user_id = (select auth.uid());
  v_nome := coalesce(v_nome, 'Suporte');
  insert into public.suporte_mensagens (restaurante_id, autor_id, autor_nome, do_suporte, texto, tipo, meta)
  values (p_rest, (select auth.uid()), v_nome, true, 'Atendimento finalizado', 'sistema',
          jsonb_build_object('acao', 'finalizado', 'atendente_id', (select auth.uid()), 'atendente_nome', v_nome));
  insert into public.suporte_estado (restaurante_id, modo, atualizado_em) values (p_rest, 'ia', now())
  on conflict (restaurante_id) do update set modo = 'ia', pedido_humano_em = null, atendente_id = null, atendente_nome = null, atualizado_em = now();
end $$;

-- Cliente avalia o atendimento finalizado
create or replace function public.suporte_avaliar(p_mensagem uuid, p_nota int, p_comentario text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.suporte_mensagens;
begin
  select * into v from public.suporte_mensagens where id = p_mensagem and tipo = 'sistema' and meta ->> 'acao' = 'finalizado';
  if not found or not public.eh_membro(v.restaurante_id) then raise exception 'Atendimento não encontrado'; end if;
  if p_nota not between 1 and 5 then raise exception 'Escolha de 1 a 5 estrelas'; end if;
  if v.meta ? 'nota' then raise exception 'Este atendimento já foi avaliado'; end if;
  insert into public.suporte_avaliacoes (restaurante_id, mensagem_id, atendente_id, atendente_nome, nota, comentario)
  values (v.restaurante_id, v.id, nullif(v.meta ->> 'atendente_id', '')::uuid, v.meta ->> 'atendente_nome', p_nota, nullif(left(trim(p_comentario), 500), ''));
  update public.suporte_mensagens set meta = meta || jsonb_build_object('nota', p_nota, 'comentario', nullif(left(trim(p_comentario), 500), ''))
  where id = v.id;
end $$;

create or replace function public.suporte_ler(p_rest uuid, p_como_suporte boolean default false)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_como_suporte and not public.eh_atendente() then return; end if;
  if not p_como_suporte and not public.eh_membro(p_rest) then return; end if;
  update public.suporte_mensagens set lida_em = now()
    where restaurante_id = p_rest and do_suporte = not p_como_suporte and lida_em is null;
end $$;

drop function if exists public.suporte_conversas();
create or replace function public.suporte_conversas()
returns table (restaurante_id uuid, nome text, logo_url text, cor text, plano text,
               ultima_texto text, ultima_tipo text, ultima_em timestamptz, ultima_do_suporte boolean, ultima_ia boolean,
               nao_lidas int, modo text, pedido_humano_em timestamptz, atendente_nome text, nota_media numeric)
language sql stable security definer set search_path = '' as $$
  select r.id, r.nome, r.logo_url, r.cor, r.plano,
         u.texto, u.tipo, u.criado_em, u.do_suporte, u.ia,
         (select count(*)::int from public.suporte_mensagens x
           where x.restaurante_id = r.id and not x.do_suporte and x.lida_em is null and x.tipo <> 'sistema'),
         coalesce(e.modo, 'ia'), e.pedido_humano_em, e.atendente_nome,
         (select round(avg(a.nota), 1) from public.suporte_avaliacoes a where a.restaurante_id = r.id)
  from public.restaurantes r
  join lateral (select m.texto, m.tipo, m.criado_em, m.do_suporte, m.ia from public.suporte_mensagens m
                where m.restaurante_id = r.id order by m.criado_em desc limit 1) u on true
  left join public.suporte_estado e on e.restaurante_id = r.id
  where public.eh_atendente()
  order by (e.modo = 'humano' and e.pedido_humano_em is not null) desc nulls last, u.criado_em desc
$$;

-- Resumo das avaliações (cabeçalho da central)
create or replace function public.suporte_avaliacoes_resumo() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.eh_atendente() then raise exception 'Só o time de suporte'; end if;
  return (select jsonb_build_object('media', round(avg(nota), 1), 'total', count(*),
    'ultimas', coalesce((select jsonb_agg(x) from (select a.nota, a.comentario, a.atendente_nome, a.criado_em, r.nome as loja
      from public.suporte_avaliacoes a join public.restaurantes r on r.id = a.restaurante_id order by a.criado_em desc limit 20) x), '[]'::jsonb))
    from public.suporte_avaliacoes);
end $$;

revoke all on function public.suporte_enviar(uuid, text, boolean, text, text, int) from public, anon;
revoke all on function public.suporte_pedir_humano(uuid, text) from public, anon;
revoke all on function public.suporte_finalizar(uuid) from public, anon;
revoke all on function public.suporte_avaliar(uuid, int, text) from public, anon;
revoke all on function public.suporte_conversas() from public, anon;
revoke all on function public.suporte_avaliacoes_resumo() from public, anon;
revoke all on function public.suporte_atendentes() from public, anon;
revoke all on function public.suporte_atendente_adicionar(text, text) from public, anon;
revoke all on function public.suporte_atendente_remover(uuid) from public, anon;
grant execute on function public.suporte_enviar(uuid, text, boolean, text, text, int) to authenticated;
grant execute on function public.suporte_pedir_humano(uuid, text) to authenticated;
grant execute on function public.suporte_finalizar(uuid) to authenticated;
grant execute on function public.suporte_avaliar(uuid, int, text) to authenticated;
grant execute on function public.suporte_conversas() to authenticated;
grant execute on function public.suporte_avaliacoes_resumo() to authenticated;
grant execute on function public.suporte_atendentes() to authenticated;
grant execute on function public.suporte_atendente_adicionar(text, text) to authenticated;
grant execute on function public.suporte_atendente_remover(uuid) to authenticated;

-- ---------- Arquivos do chat (privados: só a loja e o time de suporte) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('suporte', 'suporte', false, 12582912, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "suporte envia arquivo" on storage.objects;
drop policy if exists "suporte vê arquivo" on storage.objects;
create policy "suporte envia arquivo" on storage.objects for insert to authenticated
  with check (bucket_id = 'suporte' and (public.eh_atendente() or public.eh_membro(((storage.foldername(name))[1])::uuid)));
create policy "suporte vê arquivo" on storage.objects for select to authenticated
  using (bucket_id = 'suporte' and (public.eh_atendente() or public.eh_membro(((storage.foldername(name))[1])::uuid)));
