-- BasilFiery — esquema inicial
-- Restaurantes, equipe, cardápio, mesas, pedidos, estoque, chamados e notificações push.
-- Cada restaurante só enxerga os próprios dados (RLS). O tablet da mesa não faz login:
-- usa o token secreto da mesa e só acessa as funções mesa_*.

create extension if not exists pg_net with schema extensions;

-- Configurações internas (chaves VAPID, segredo do webhook). Fora da API.
create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;
create table privado.config (chave text primary key, valor text not null);

create type public.papel_membro as enum ('dono', 'gerente', 'caixa', 'garcom');
create type public.status_pedido as enum ('novo', 'preparando', 'pronto', 'entregue', 'cancelado');

create table public.restaurantes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slogan text,
  logo_url text,
  cor text not null default '#ff5a1f',
  plano text not null default 'essencial',
  ativo boolean not null default true,
  ultimo_pedido int not null default 0,
  criado_em timestamptz not null default now()
);

create table public.plataforma_admins (
  user_id uuid primary key references auth.users on delete cascade
);

create table public.membros (
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  papel public.papel_membro not null,
  nome text not null,
  email text,
  criado_em timestamptz not null default now(),
  primary key (restaurante_id, user_id)
);
create index on public.membros (user_id);

create table public.categorias (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  nome text not null,
  emoji text,
  ordem int not null default 0,
  ativo boolean not null default true
);
create index on public.categorias (restaurante_id);

create table public.produtos (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  categoria_id uuid references public.categorias on delete set null,
  nome text not null,
  descricao text not null default '',
  preco numeric(10,2) not null check (preco >= 0),
  emoji text,
  imagem_url text,
  vegetariano boolean not null default false,
  picancia smallint not null default 0 check (picancia between 0 and 3),
  destaque boolean not null default false,
  novo boolean not null default false,
  ativo boolean not null default true,
  ordem int not null default 0,
  controla_estoque boolean not null default false,
  estoque int not null default 0 check (estoque >= 0),
  estoque_minimo int not null default 0,
  criado_em timestamptz not null default now()
);
create index on public.produtos (restaurante_id);
create index on public.produtos (categoria_id);

create table public.mesas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  nome text not null,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  ativo boolean not null default true,
  ordem int not null default 0
);
create index on public.mesas (restaurante_id);

create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  mesa_id uuid references public.mesas on delete set null,
  mesa_nome text not null,
  numero int not null,
  status public.status_pedido not null default 'novo',
  observacao text,
  total numeric(10,2) not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  impresso_em timestamptz,
  pago_em timestamptz
);
create index on public.pedidos (restaurante_id, criado_em desc);
create index on public.pedidos (mesa_id) where pago_em is null;

create table public.pedido_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos on delete cascade,
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  produto_id uuid references public.produtos on delete set null,
  nome text not null,
  preco_unit numeric(10,2) not null,
  qtd int not null check (qtd > 0),
  obs text
);
create index on public.pedido_itens (pedido_id);
create index on public.pedido_itens (restaurante_id);
create index on public.pedido_itens (produto_id);

create table public.chamados (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  mesa_id uuid references public.mesas on delete cascade,
  mesa_nome text not null,
  tipo text not null check (tipo in ('garcom', 'conta')),
  criado_em timestamptz not null default now(),
  atendido_em timestamptz
);
create index on public.chamados (restaurante_id) where atendido_em is null;
create index on public.chamados (mesa_id);

create table public.movimentos_estoque (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  produto_id uuid not null references public.produtos on delete cascade,
  delta int not null,
  motivo text not null,
  pedido_id uuid references public.pedidos on delete set null,
  user_id uuid references auth.users on delete set null default auth.uid(),
  criado_em timestamptz not null default now()
);
create index on public.movimentos_estoque (restaurante_id, criado_em desc);
create index on public.movimentos_estoque (produto_id);
create index on public.movimentos_estoque (pedido_id);
create index on public.movimentos_estoque (user_id);

create table public.push_inscricoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  criado_em timestamptz not null default now()
);
create index on public.push_inscricoes (restaurante_id);
create index on public.push_inscricoes (user_id);

-- ============ Funções de permissão ============
create function public.eh_admin_plataforma() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plataforma_admins where user_id = (select auth.uid()));
$$;

create function public.eh_membro(p_rest uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membros where restaurante_id = p_rest and user_id = (select auth.uid()))
      or public.eh_admin_plataforma();
$$;

create function public.tem_papel(p_rest uuid, p_papeis public.papel_membro[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.membros
    where restaurante_id = p_rest and user_id = (select auth.uid()) and papel = any (p_papeis)
  ) or public.eh_admin_plataforma();
$$;

-- ============ RLS ============
alter table public.restaurantes enable row level security;
alter table public.plataforma_admins enable row level security;
alter table public.membros enable row level security;
alter table public.categorias enable row level security;
alter table public.produtos enable row level security;
alter table public.mesas enable row level security;
alter table public.pedidos enable row level security;
alter table public.pedido_itens enable row level security;
alter table public.chamados enable row level security;
alter table public.movimentos_estoque enable row level security;
alter table public.push_inscricoes enable row level security;

revoke all on all tables in schema public from anon;

create policy "ver restaurante" on public.restaurantes for select to authenticated
  using (public.eh_membro(id));
create policy "gestor edita restaurante" on public.restaurantes for update to authenticated
  using (public.tem_papel(id, '{dono,gerente}')) with check (public.tem_papel(id, '{dono,gerente}'));
revoke insert, update, delete on public.restaurantes from authenticated;
grant update (nome, slogan, logo_url, cor) on public.restaurantes to authenticated;

create policy "ver a si mesmo" on public.plataforma_admins for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete on public.plataforma_admins from authenticated;

create policy "ver equipe" on public.membros for select to authenticated
  using (public.eh_membro(restaurante_id));
create policy "gestor edita equipe" on public.membros for update to authenticated
  using (public.tem_papel(restaurante_id, '{dono,gerente}') and papel <> 'dono')
  with check (public.tem_papel(restaurante_id, '{dono,gerente}') and papel <> 'dono');
create policy "gestor remove equipe" on public.membros for delete to authenticated
  using (public.tem_papel(restaurante_id, '{dono,gerente}') and papel <> 'dono');
revoke insert, update on public.membros from authenticated;
grant update (nome, papel) on public.membros to authenticated;

create policy "ver categorias" on public.categorias for select to authenticated using (public.eh_membro(restaurante_id));
create policy "gestor cria categorias" on public.categorias for insert to authenticated with check (public.tem_papel(restaurante_id, '{dono,gerente}'));
create policy "gestor edita categorias" on public.categorias for update to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente}')) with check (public.tem_papel(restaurante_id, '{dono,gerente}'));
create policy "gestor apaga categorias" on public.categorias for delete to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente}'));

create policy "ver produtos" on public.produtos for select to authenticated using (public.eh_membro(restaurante_id));
create policy "gestor cria produtos" on public.produtos for insert to authenticated with check (public.tem_papel(restaurante_id, '{dono,gerente}'));
create policy "gestor edita produtos" on public.produtos for update to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente}')) with check (public.tem_papel(restaurante_id, '{dono,gerente}'));
create policy "gestor apaga produtos" on public.produtos for delete to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente}'));
-- Estoque só muda via estoque_ajustar() (gera histórico)
revoke update on public.produtos from authenticated;
grant update (categoria_id, nome, descricao, preco, emoji, imagem_url, vegetariano, picancia, destaque, novo, ativo, ordem, controla_estoque, estoque_minimo)
  on public.produtos to authenticated;

create policy "ver mesas" on public.mesas for select to authenticated using (public.eh_membro(restaurante_id));
create policy "gestor cria mesas" on public.mesas for insert to authenticated with check (public.tem_papel(restaurante_id, '{dono,gerente}'));
create policy "gestor edita mesas" on public.mesas for update to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente}')) with check (public.tem_papel(restaurante_id, '{dono,gerente}'));
create policy "gestor apaga mesas" on public.mesas for delete to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente}'));

create policy "ver pedidos" on public.pedidos for select to authenticated using (public.eh_membro(restaurante_id));
create policy "ver itens" on public.pedido_itens for select to authenticated using (public.eh_membro(restaurante_id));
create policy "ver chamados" on public.chamados for select to authenticated using (public.eh_membro(restaurante_id));
create policy "ver movimentos" on public.movimentos_estoque for select to authenticated using (public.eh_membro(restaurante_id));
revoke insert, update, delete on public.pedidos, public.pedido_itens, public.chamados, public.movimentos_estoque from authenticated;

create policy "ver minhas inscricoes" on public.push_inscricoes for select to authenticated using (user_id = (select auth.uid()));
create policy "apagar minhas inscricoes" on public.push_inscricoes for delete to authenticated using (user_id = (select auth.uid()));
revoke insert, update on public.push_inscricoes from authenticated;

-- ============ RPCs do tablet (anônimo, identificado pelo token da mesa) ============
create function public.mesa_cardapio(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mesa public.mesas;
  v_rest public.restaurantes;
begin
  select * into v_mesa from public.mesas where token = p_token and ativo;
  if not found then raise exception 'Mesa não encontrada'; end if;
  select * into v_rest from public.restaurantes where id = v_mesa.restaurante_id;
  if not v_rest.ativo then raise exception 'Restaurante indisponível no momento'; end if;

  return jsonb_build_object(
    'restaurante', jsonb_build_object('id', v_rest.id, 'nome', v_rest.nome, 'slogan', v_rest.slogan, 'logo_url', v_rest.logo_url, 'cor', v_rest.cor),
    'mesa', jsonb_build_object('id', v_mesa.id, 'nome', v_mesa.nome),
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'emoji', c.emoji) order by c.ordem, c.nome)
      from public.categorias c where c.restaurante_id = v_rest.id and c.ativo
    ), '[]'::jsonb),
    'produtos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'categoria_id', p.categoria_id, 'nome', p.nome, 'descricao', p.descricao,
        'preco', p.preco, 'emoji', p.emoji, 'imagem_url', p.imagem_url,
        'vegetariano', p.vegetariano, 'picancia', p.picancia, 'destaque', p.destaque, 'novo', p.novo,
        'disponivel', (not p.controla_estoque) or p.estoque > 0,
        'estoque_max', case when p.controla_estoque then p.estoque end
      ) order by p.ordem, p.nome)
      from public.produtos p
      join public.categorias c on c.id = p.categoria_id and c.ativo
      where p.restaurante_id = v_rest.id and p.ativo
    ), '[]'::jsonb)
  );
end $$;

create function public.mesa_criar_pedido(p_token text, p_itens jsonb, p_obs text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_mesa public.mesas;
  v_rest public.restaurantes;
  v_item jsonb;
  v_prod public.produtos;
  v_qtd int;
  v_total numeric(10,2) := 0;
  v_linhas jsonb := '[]'::jsonb;
  v_numero int;
  v_pedido uuid;
begin
  select * into v_mesa from public.mesas where token = p_token and ativo;
  if not found then raise exception 'Mesa não encontrada'; end if;
  select * into v_rest from public.restaurantes where id = v_mesa.restaurante_id;
  if not v_rest.ativo then raise exception 'Restaurante indisponível no momento'; end if;
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'O pedido está vazio';
  end if;
  if jsonb_array_length(p_itens) > 50 then raise exception 'Itens demais em um só pedido'; end if;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_qtd := (v_item ->> 'qtd')::int;
    if v_qtd is null or v_qtd < 1 or v_qtd > 50 then raise exception 'Quantidade inválida'; end if;

    select * into v_prod from public.produtos
    where id = (v_item ->> 'produto_id')::uuid and restaurante_id = v_rest.id and ativo
    for update;
    if not found then raise exception 'Um dos itens não está mais disponível'; end if;

    if v_prod.controla_estoque then
      if v_prod.estoque < v_qtd then
        raise exception 'Estoque insuficiente de "%" (restam %)', v_prod.nome, v_prod.estoque;
      end if;
      update public.produtos set estoque = estoque - v_qtd where id = v_prod.id;
    end if;

    v_total := v_total + v_prod.preco * v_qtd;
    v_linhas := v_linhas || jsonb_build_object(
      'produto_id', v_prod.id, 'nome', v_prod.nome, 'preco', v_prod.preco, 'qtd', v_qtd,
      'obs', nullif(left(trim(v_item ->> 'obs'), 140), ''), 'controla', v_prod.controla_estoque
    );
  end loop;

  update public.restaurantes set ultimo_pedido = ultimo_pedido + 1
  where id = v_rest.id returning ultimo_pedido into v_numero;

  insert into public.pedidos (restaurante_id, mesa_id, mesa_nome, numero, observacao, total)
  values (v_rest.id, v_mesa.id, v_mesa.nome, v_numero, nullif(left(trim(p_obs), 300), ''), v_total)
  returning id into v_pedido;

  insert into public.pedido_itens (pedido_id, restaurante_id, produto_id, nome, preco_unit, qtd, obs)
  select v_pedido, v_rest.id, (l ->> 'produto_id')::uuid, l ->> 'nome', (l ->> 'preco')::numeric, (l ->> 'qtd')::int, l ->> 'obs'
  from jsonb_array_elements(v_linhas) l;

  insert into public.movimentos_estoque (restaurante_id, produto_id, delta, motivo, pedido_id, user_id)
  select v_rest.id, (l ->> 'produto_id')::uuid, -((l ->> 'qtd')::int), 'Pedido #' || v_numero, v_pedido, null
  from jsonb_array_elements(v_linhas) l where (l ->> 'controla')::boolean;

  return jsonb_build_object('id', v_pedido, 'numero', v_numero, 'total', v_total);
end $$;

create function public.mesa_conta(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mesa public.mesas;
begin
  select * into v_mesa from public.mesas where token = p_token and ativo;
  if not found then raise exception 'Mesa não encontrada'; end if;
  return jsonb_build_object(
    'pedidos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'numero', p.numero, 'status', p.status, 'total', p.total, 'criado_em', p.criado_em,
        'itens', (select jsonb_agg(jsonb_build_object('nome', i.nome, 'qtd', i.qtd, 'preco', i.preco_unit, 'obs', i.obs))
                  from public.pedido_itens i where i.pedido_id = p.id)
      ) order by p.criado_em)
      from public.pedidos p
      where p.mesa_id = v_mesa.id and p.pago_em is null and p.status <> 'cancelado'
    ), '[]'::jsonb),
    'total', coalesce((
      select sum(p.total) from public.pedidos p
      where p.mesa_id = v_mesa.id and p.pago_em is null and p.status <> 'cancelado'
    ), 0)
  );
end $$;

create function public.mesa_chamar(p_token text, p_tipo text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_mesa public.mesas;
begin
  if p_tipo not in ('garcom', 'conta') then raise exception 'Tipo inválido'; end if;
  select * into v_mesa from public.mesas where token = p_token and ativo;
  if not found then raise exception 'Mesa não encontrada'; end if;
  if exists (select 1 from public.chamados where mesa_id = v_mesa.id and tipo = p_tipo and atendido_em is null) then
    return;
  end if;
  insert into public.chamados (restaurante_id, mesa_id, mesa_nome, tipo)
  values (v_mesa.restaurante_id, v_mesa.id, v_mesa.nome, p_tipo);
end $$;

create function public.plataforma_tem_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plataforma_admins);
$$;

-- ============ RPCs da equipe ============
create function public.pedido_mudar_status(p_pedido uuid, p_status public.status_pedido) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.pedidos;
begin
  select * into v from public.pedidos where id = p_pedido for update;
  if not found or not public.eh_membro(v.restaurante_id) then raise exception 'Pedido não encontrado'; end if;
  if v.status = p_status then return; end if;
  if v.status = 'cancelado' then raise exception 'Este pedido já foi cancelado'; end if;

  if p_status = 'cancelado' then
    -- devolve ao estoque o que foi baixado
    with q as (
      select i.produto_id, sum(i.qtd)::int as qtd
      from public.pedido_itens i join public.produtos p on p.id = i.produto_id
      where i.pedido_id = v.id and p.controla_estoque
      group by i.produto_id
    ), u as (
      update public.produtos p set estoque = p.estoque + q.qtd from q where p.id = q.produto_id returning p.id
    )
    insert into public.movimentos_estoque (restaurante_id, produto_id, delta, motivo, pedido_id)
    select v.restaurante_id, q.produto_id, q.qtd, 'Cancelamento do pedido #' || v.numero, v.id from q;
  end if;

  update public.pedidos set status = p_status, atualizado_em = now() where id = v.id;
end $$;

create function public.pedido_marcar_impresso(p_pedido uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ok boolean;
begin
  update public.pedidos set impresso_em = now()
  where id = p_pedido and impresso_em is null and public.eh_membro(restaurante_id)
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

create function public.mesa_fechar_conta(p_mesa uuid) returns numeric
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rest uuid;
  v_total numeric;
begin
  select restaurante_id into v_rest from public.mesas where id = p_mesa;
  if v_rest is null or not public.tem_papel(v_rest, '{dono,gerente,caixa}') then
    raise exception 'Sem permissão para fechar contas';
  end if;
  with f as (
    update public.pedidos set pago_em = now()
    where mesa_id = p_mesa and pago_em is null
    returning case when status = 'cancelado' then 0 else total end as valor
  )
  select coalesce(sum(valor), 0) into v_total from f;
  update public.chamados set atendido_em = now() where mesa_id = p_mesa and atendido_em is null;
  return v_total;
end $$;

create function public.chamado_atender(p_chamado uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.chamados set atendido_em = now()
  where id = p_chamado and atendido_em is null and public.eh_membro(restaurante_id);
end $$;

create function public.estoque_ajustar(p_produto uuid, p_delta int, p_motivo text default null) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.produtos;
begin
  select * into v from public.produtos where id = p_produto for update;
  if not found or not public.tem_papel(v.restaurante_id, '{dono,gerente,caixa}') then
    raise exception 'Sem permissão para alterar o estoque';
  end if;
  if p_delta = 0 then return v.estoque; end if;
  if v.estoque + p_delta < 0 then raise exception 'O estoque não pode ficar negativo'; end if;
  update public.produtos set estoque = estoque + p_delta where id = v.id;
  insert into public.movimentos_estoque (restaurante_id, produto_id, delta, motivo)
  values (v.restaurante_id, v.id, p_delta,
          coalesce(nullif(trim(p_motivo), ''), case when p_delta > 0 then 'Entrada' else 'Saída' end));
  return v.estoque + p_delta;
end $$;

create function public.push_inscrever(p_rest uuid, p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.eh_membro(p_rest) then raise exception 'Sem permissão'; end if;
  delete from public.push_inscricoes where endpoint = p_endpoint;
  insert into public.push_inscricoes (user_id, restaurante_id, endpoint, p256dh, auth)
  values ((select auth.uid()), p_rest, p_endpoint, p_p256dh, p_auth);
end $$;

-- Só para as edge functions (service_role)
create function public.config_push() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(chave, valor), '{}'::jsonb) from privado.config;
$$;

create function public.usuario_por_email(p_email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;

-- Guarda o par de chaves VAPID só na primeira vez e devolve o par vigente
create function public.config_vapid_garantir(p_publica text, p_privada text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into privado.config (chave, valor)
  values ('vapid', jsonb_build_object('publica', p_publica, 'privada', p_privada)::text)
  on conflict (chave) do nothing;
  return (select valor::jsonb from privado.config where chave = 'vapid');
end $$;

-- Endereço da edge function e segredo gerado aqui mesmo (não fica no código)
insert into privado.config (chave, valor) values
  ('push_url', 'https://gpnjhwiuwotmkqvzeojt.supabase.co/functions/v1/notificar'),
  ('push_segredo', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (chave) do nothing;

-- ============ Notificação push (dispara a edge function "notificar") ============
create function privado.notificar_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_segredo text;
  v_payload jsonb;
begin
  select valor into v_url from privado.config where chave = 'push_url';
  select valor into v_segredo from privado.config where chave = 'push_segredo';
  if v_url is null then return new; end if;

  if tg_table_name = 'pedidos' then
    if tg_op = 'INSERT' then
      v_payload := jsonb_build_object(
        'titulo', 'Novo pedido #' || new.numero || ' · ' || new.mesa_nome,
        'corpo', 'Total R$ ' || replace(to_char(new.total, 'FM999990.00'), '.', ','),
        'tag', 'pedido-' || new.id);
    elsif new.status = 'pronto' and old.status is distinct from 'pronto' then
      v_payload := jsonb_build_object(
        'titulo', 'Pedido #' || new.numero || ' pronto · ' || new.mesa_nome,
        'corpo', 'Pode levar para a mesa.',
        'tag', 'pedido-' || new.id);
    else
      return new;
    end if;
  elsif tg_table_name = 'chamados' then
    v_payload := jsonb_build_object(
      'titulo', case when new.tipo = 'conta' then new.mesa_nome || ' pediu a conta' else new.mesa_nome || ' chamou o garçom' end,
      'corpo', 'Toque para ver.',
      'tag', 'chamado-' || new.id);
  else
    return new;
  end if;

  v_payload := v_payload || jsonb_build_object('restaurante_id', new.restaurante_id, 'url', '/garcom');
  perform net.http_post(
    url := v_url,
    body := v_payload,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-segredo', v_segredo)
  );
  return new;
end $$;

create trigger pedidos_push after insert or update of status on public.pedidos
  for each row execute function privado.notificar_push();
create trigger chamados_push after insert on public.chamados
  for each row execute function privado.notificar_push();

-- ============ Permissões de execução ============
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema privado from public, anon, authenticated;

grant execute on function
  public.mesa_cardapio(text),
  public.mesa_criar_pedido(text, jsonb, text),
  public.mesa_conta(text),
  public.mesa_chamar(text, text),
  public.plataforma_tem_admin()
to anon, authenticated;

grant execute on function
  public.eh_admin_plataforma(),
  public.eh_membro(uuid),
  public.tem_papel(uuid, public.papel_membro[]),
  public.pedido_mudar_status(uuid, public.status_pedido),
  public.pedido_marcar_impresso(uuid),
  public.mesa_fechar_conta(uuid),
  public.chamado_atender(uuid),
  public.estoque_ajustar(uuid, int, text),
  public.push_inscrever(uuid, text, text, text)
to authenticated;

grant execute on function
  public.config_push(),
  public.config_vapid_garantir(text, text),
  public.usuario_por_email(text)
to service_role;

-- ============ Tempo real ============
alter publication supabase_realtime add table public.pedidos, public.chamados, public.produtos;

-- ============ Imagens dos produtos ============
insert into storage.buckets (id, name, public) values ('imagens', 'imagens', true) on conflict (id) do nothing;

create policy "gestor envia imagens" on storage.objects for insert to authenticated
  with check (bucket_id = 'imagens' and public.tem_papel(((storage.foldername(name))[1])::uuid, '{dono,gerente}'));
create policy "gestor troca imagens" on storage.objects for update to authenticated
  using (bucket_id = 'imagens' and public.tem_papel(((storage.foldername(name))[1])::uuid, '{dono,gerente}'));
create policy "gestor apaga imagens" on storage.objects for delete to authenticated
  using (bucket_id = 'imagens' and public.tem_papel(((storage.foldername(name))[1])::uuid, '{dono,gerente}'));
