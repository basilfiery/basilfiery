-- =====================================================================
-- 1) Modelos de impressão (cabeçalho, logo, CNPJ, rodapé) por restaurante
-- 2) Lista de compras da equipe: cada funcionário tem acesso próprio pelo link
-- =====================================================================

alter table public.restaurantes add column impressao jsonb not null default '{}'::jsonb;
grant update (impressao) on public.restaurantes to authenticated;

-- ---------- Lista de compras ----------
create table public.compras_pessoas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  nome text not null check (char_length(trim(nome)) between 2 and 60),
  setor text not null default 'Outro' check (char_length(setor) <= 30),
  pin_hash text not null,
  token_hash text,
  status text not null default 'pendente' check (status in ('pendente', 'ativo', 'bloqueado')),
  tentativas int not null default 0,
  travado_ate timestamptz,
  criado_em timestamptz not null default now(),
  ultimo_acesso timestamptz
);
create unique index compras_pessoas_nome on public.compras_pessoas (restaurante_id, lower(trim(nome)));
create index on public.compras_pessoas (token_hash);

create table public.compras_itens (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  nome text not null check (char_length(trim(nome)) between 1 and 80),
  quantidade text check (char_length(quantidade) <= 30),
  obs text check (char_length(obs) <= 200),
  setor text check (char_length(setor) <= 30),
  urgente boolean not null default false,
  pessoa_id uuid references public.compras_pessoas on delete set null,
  pedido_por text check (char_length(pedido_por) <= 60),
  status text not null default 'pendente' check (status in ('pendente', 'comprado')),
  criado_em timestamptz not null default now(),
  comprado_em timestamptz,
  comprado_por text
);
create index on public.compras_itens (restaurante_id, status, criado_em desc);

alter table public.compras_pessoas enable row level security;
alter table public.compras_itens enable row level security;
revoke all on public.compras_pessoas, public.compras_itens from anon;
-- Os hashes nunca saem para o navegador
revoke select on public.compras_pessoas from authenticated;
grant select (id, restaurante_id, nome, setor, status, criado_em, ultimo_acesso) on public.compras_pessoas to authenticated;
revoke insert, update on public.compras_pessoas from authenticated;
grant update (status, setor) on public.compras_pessoas to authenticated;

create policy "gestor vê equipe da lista" on public.compras_pessoas for select to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente}'));
create policy "gestor libera equipe da lista" on public.compras_pessoas for update to authenticated
  using (public.tem_papel(restaurante_id, '{dono,gerente}')) with check (public.tem_papel(restaurante_id, '{dono,gerente}'));
create policy "gestor tira da lista" on public.compras_pessoas for delete to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente}'));

create policy "equipe vê a lista" on public.compras_itens for select to authenticated using (public.eh_membro(restaurante_id));
create policy "equipe põe na lista" on public.compras_itens for insert to authenticated with check (public.eh_membro(restaurante_id) and pessoa_id is null);
create policy "caixa marca comprado" on public.compras_itens for update to authenticated
  using (public.tem_papel(restaurante_id, '{dono,gerente,caixa}')) with check (public.tem_papel(restaurante_id, '{dono,gerente,caixa}'));
create policy "gestor apaga da lista" on public.compras_itens for delete to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente,caixa}'));

alter publication supabase_realtime add table public.compras_itens, public.compras_pessoas;

-- Acesso do funcionário pelo link (sem conta de login): token guardado no celular dele
create function privado.compras_pessoa(p_token text) returns public.compras_pessoas
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.compras_pessoas;
begin
  if p_token is null or p_token !~ '^lc_[0-9a-f]{48}$' then raise exception 'SESSAO_INVALIDA'; end if;
  select * into v from public.compras_pessoas where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if not found then raise exception 'SESSAO_INVALIDA'; end if;
  return v;
end $$;

create function public.compras_loja(p_codigo text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nome', r.nome, 'logo_url', r.logo_url, 'cor', r.cor)
  from public.restaurantes r where r.codigo = lower(trim(p_codigo)) and r.ativo
$$;

create function public.compras_cadastrar(p_codigo text, p_nome text, p_setor text, p_pin text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rest uuid;
  v_token text := 'lc_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_nome text := left(regexp_replace(trim(p_nome), '\s+', ' ', 'g'), 60);
begin
  select id into v_rest from public.restaurantes where codigo = lower(trim(p_codigo)) and ativo;
  if v_rest is null then raise exception 'Link inválido. Peça um novo ao responsável.'; end if;
  if char_length(v_nome) < 2 then raise exception 'Digite seu nome'; end if;
  if p_pin !~ '^[0-9]{4,6}$' then raise exception 'A senha precisa ter de 4 a 6 números'; end if;
  if (select count(*) from public.compras_pessoas where restaurante_id = v_rest and status = 'pendente') >= 30 then
    raise exception 'Muitos cadastros aguardando. Peça ao responsável para liberar.';
  end if;
  if exists (select 1 from public.compras_pessoas where restaurante_id = v_rest and lower(trim(nome)) = lower(v_nome)) then
    raise exception 'Já existe alguém com esse nome. Use "Já tenho cadastro" ou coloque o sobrenome.';
  end if;
  insert into public.compras_pessoas (restaurante_id, nome, setor, pin_hash, token_hash, ultimo_acesso)
  values (v_rest, v_nome, coalesce(nullif(left(trim(p_setor), 30), ''), 'Outro'),
    extensions.crypt(p_pin, extensions.gen_salt('bf')), encode(extensions.digest(v_token, 'sha256'), 'hex'), now());
  return v_token;
end $$;

create function public.compras_entrar(p_codigo text, p_nome text, p_pin text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.compras_pessoas;
  v_token text := 'lc_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  select p.* into v from public.compras_pessoas p join public.restaurantes r on r.id = p.restaurante_id
  where r.codigo = lower(trim(p_codigo)) and lower(trim(p.nome)) = lower(regexp_replace(trim(p_nome), '\s+', ' ', 'g'));
  if not found then raise exception 'Nome ou senha incorretos'; end if;
  if v.travado_ate is not null and v.travado_ate > now() then raise exception 'Muitas tentativas. Espere 15 minutos.'; end if;
  if v.pin_hash <> extensions.crypt(coalesce(p_pin, ''), v.pin_hash) then
    update public.compras_pessoas set tentativas = tentativas + 1,
      travado_ate = case when tentativas + 1 >= 5 then now() + interval '15 minutes' end
    where id = v.id;
    raise exception 'Nome ou senha incorretos';
  end if;
  if v.status = 'bloqueado' then raise exception 'Seu acesso foi desligado. Fale com o responsável.'; end if;
  update public.compras_pessoas set tentativas = 0, travado_ate = null, ultimo_acesso = now(),
    token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
  where id = v.id;
  return v_token;
end $$;

create function public.compras_eu(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.compras_pessoas := privado.compras_pessoa(p_token);
begin
  update public.compras_pessoas set ultimo_acesso = now() where id = v.id;
  return jsonb_build_object(
    'pessoa', jsonb_build_object('nome', v.nome, 'setor', v.setor, 'status', v.status),
    'loja', (select jsonb_build_object('nome', r.nome, 'logo_url', r.logo_url, 'cor', r.cor) from public.restaurantes r where r.id = v.restaurante_id),
    'itens', case when v.status = 'ativo' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'nome', i.nome, 'quantidade', i.quantidade, 'obs', i.obs, 'setor', i.setor, 'urgente', i.urgente,
        'pedido_por', i.pedido_por, 'meu', i.pessoa_id = v.id, 'status', i.status, 'criado_em', i.criado_em, 'comprado_em', i.comprado_em
      ) order by i.status, i.urgente desc, i.criado_em desc)
      from public.compras_itens i
      where i.restaurante_id = v.restaurante_id
        and (i.status = 'pendente' or (i.pessoa_id = v.id and i.comprado_em > now() - interval '3 days'))
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end $$;

create function public.compras_pedir(p_token text, p_nome text, p_quantidade text, p_obs text, p_urgente boolean) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.compras_pessoas := privado.compras_pessoa(p_token);
  v_id uuid;
begin
  if v.status <> 'ativo' then raise exception 'Seu acesso ainda não foi liberado'; end if;
  if nullif(trim(p_nome), '') is null then raise exception 'Escreva o que precisa comprar'; end if;
  if (select count(*) from public.compras_itens where pessoa_id = v.id and status = 'pendente') >= 80 then
    raise exception 'Sua lista já está grande. Espere a próxima compra.';
  end if;
  insert into public.compras_itens (restaurante_id, nome, quantidade, obs, setor, urgente, pessoa_id, pedido_por)
  values (v.restaurante_id, left(trim(p_nome), 80), nullif(left(trim(coalesce(p_quantidade, '')), 30), ''),
    nullif(left(trim(coalesce(p_obs, '')), 200), ''), v.setor, coalesce(p_urgente, false), v.id, v.nome)
  returning id into v_id;
  return v_id;
end $$;

create function public.compras_remover(p_token text, p_item uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.compras_pessoas := privado.compras_pessoa(p_token);
begin
  delete from public.compras_itens where id = p_item and pessoa_id = v.id and status = 'pendente';
end $$;

revoke execute on function public.compras_loja(text), public.compras_cadastrar(text, text, text, text), public.compras_entrar(text, text, text),
  public.compras_eu(text), public.compras_pedir(text, text, text, text, boolean), public.compras_remover(text, uuid) from public;
grant execute on function public.compras_loja(text), public.compras_cadastrar(text, text, text, text), public.compras_entrar(text, text, text),
  public.compras_eu(text), public.compras_pedir(text, text, text, text, boolean), public.compras_remover(text, uuid) to anon, authenticated;
revoke execute on function privado.compras_pessoa(text) from public;
