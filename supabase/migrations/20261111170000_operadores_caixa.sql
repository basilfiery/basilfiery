-- Operadores de caixa: cada caixa é aberto e fechado com o usuário e a senha de quem opera.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.caixa_operadores (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  nome text not null check (char_length(trim(nome)) between 2 and 60),
  usuario text not null check (usuario ~ '^[a-z0-9._-]{3,30}$'),
  senha_hash text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  ultimo_acesso timestamptz,
  unique (restaurante_id, usuario)
);
alter table public.caixa_operadores enable row level security;
-- Lista de operadores: só a gestão vê (a senha nunca sai do banco)
drop policy if exists "gestor ve operadores" on public.caixa_operadores;
create policy "gestor ve operadores" on public.caixa_operadores for select to authenticated
  using (public.tem_papel(restaurante_id, '{dono,gerente}'));
revoke all on public.caixa_operadores from anon, authenticated;
grant select (id, restaurante_id, nome, usuario, ativo, criado_em, ultimo_acesso) on public.caixa_operadores to authenticated;

alter table public.caixas
  add column if not exists operador_id uuid references public.caixa_operadores(id) on delete set null,
  add column if not exists operador_nome text,
  add column if not exists fechado_operador_nome text;
alter table public.caixa_movimentos add column if not exists operador_nome text;
create index if not exists caixas_operador_idx on public.caixas (operador_id) where operador_id is not null;
create index if not exists caixas_rest_aberto_idx on public.caixas (restaurante_id, aberto_em desc);

-- Quantos operadores ativos a loja tem (a tela de abrir caixa usa para saber se pede login)
create or replace function public.caixa_operadores_qtd(p_rest uuid)
returns int language sql stable security definer set search_path to '' as $$
  select case when public.tem_papel(p_rest, '{dono,gerente,caixa}')
    then (select count(*)::int from public.caixa_operadores where restaurante_id = p_rest and ativo) else 0 end;
$$;

-- Confere usuário e senha do operador (devolve o operador ou erro)
create or replace function privado.caixa_operador_conferir(p_rest uuid, p_usuario text, p_senha text)
returns public.caixa_operadores language plpgsql security definer set search_path to '' as $$
declare o public.caixa_operadores;
begin
  select * into o from public.caixa_operadores
  where restaurante_id = p_rest and usuario = lower(trim(coalesce(p_usuario, ''))) and ativo;
  if not found or o.senha_hash <> extensions.crypt(coalesce(p_senha, ''), o.senha_hash) then
    perform pg_sleep(1); -- freia quem tenta adivinhar a senha
    raise exception 'Usuário ou senha do operador incorretos';
  end if;
  update public.caixa_operadores set ultimo_acesso = now() where id = o.id;
  return o;
end $$;

-- Cadastrar / editar operador (senha em branco na edição = mantém)
create or replace function public.caixa_operador_salvar(p_rest uuid, p_id uuid, p_nome text, p_usuario text, p_senha text, p_ativo boolean default true)
returns uuid language plpgsql security definer set search_path to '' as $$
declare v_id uuid; v_usuario text := lower(trim(coalesce(p_usuario, '')));
begin
  if not public.tem_papel(p_rest, '{dono,gerente}') then raise exception 'Só o dono ou o gerente cadastra operadores'; end if;
  if v_usuario !~ '^[a-z0-9._-]{3,30}$' then raise exception 'Usuário: de 3 a 30 letras ou números, sem espaço nem acento'; end if;
  if char_length(trim(coalesce(p_nome, ''))) < 2 then raise exception 'Informe o nome do operador'; end if;
  if exists (select 1 from public.caixa_operadores where restaurante_id = p_rest and usuario = v_usuario and id is distinct from p_id) then
    raise exception 'Já existe um operador com o usuário "%"', v_usuario;
  end if;
  if p_id is null then
    if char_length(coalesce(p_senha, '')) < 4 then raise exception 'A senha precisa ter pelo menos 4 caracteres'; end if;
    insert into public.caixa_operadores (restaurante_id, nome, usuario, senha_hash, ativo)
    values (p_rest, trim(p_nome), v_usuario, extensions.crypt(p_senha, extensions.gen_salt('bf')), coalesce(p_ativo, true))
    returning id into v_id;
  else
    if nullif(p_senha, '') is not null and char_length(p_senha) < 4 then raise exception 'A senha precisa ter pelo menos 4 caracteres'; end if;
    update public.caixa_operadores set nome = trim(p_nome), usuario = v_usuario, ativo = coalesce(p_ativo, ativo),
      senha_hash = case when nullif(p_senha, '') is null then senha_hash else extensions.crypt(p_senha, extensions.gen_salt('bf')) end
    where id = p_id and restaurante_id = p_rest returning id into v_id;
    if v_id is null then raise exception 'Operador não encontrado'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.caixa_operador_remover(p_id uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v_rest uuid;
begin
  select restaurante_id into v_rest from public.caixa_operadores where id = p_id;
  if v_rest is null or not public.tem_papel(v_rest, '{dono,gerente}') then raise exception 'Operador não encontrado'; end if;
  -- Quem já operou caixa fica no histórico: só desativa
  if exists (select 1 from public.caixas where operador_id = p_id) then
    update public.caixa_operadores set ativo = false where id = p_id;
  else
    delete from public.caixa_operadores where id = p_id;
  end if;
end $$;

-- Abrir caixa: com operadores cadastrados, exige usuário e senha de um deles
drop function if exists public.caixa_abrir(uuid, numeric);
create or replace function public.caixa_abrir(p_rest uuid, p_valor_inicial numeric, p_usuario text default null, p_senha text default null)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  v_id uuid;
  o public.caixa_operadores;
begin
  if not public.tem_papel(p_rest, '{dono,gerente,caixa}') then raise exception 'Sem permissão para abrir o caixa'; end if;
  if exists (select 1 from public.caixas where restaurante_id = p_rest and fechado_em is null) then
    raise exception 'O caixa já está aberto';
  end if;
  if exists (select 1 from public.caixa_operadores where restaurante_id = p_rest and ativo) then
    o := privado.caixa_operador_conferir(p_rest, p_usuario, p_senha);
  end if;
  insert into public.caixas (restaurante_id, aberto_por, aberto_por_nome, valor_inicial, operador_id, operador_nome)
  values (p_rest, (select auth.uid()), coalesce(o.nome, public.nome_membro(p_rest)), greatest(coalesce(p_valor_inicial, 0), 0), o.id, o.nome)
  returning id into v_id;
  return v_id;
end $$;

-- Fechar caixa: também com usuário e senha do operador (quem confere o dinheiro assina o fechamento)
drop function if exists public.caixa_fechar(uuid, numeric, text);
create or replace function public.caixa_fechar(p_caixa uuid, p_valor_contado numeric, p_obs text, p_usuario text default null, p_senha text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  c public.caixas;
  o public.caixa_operadores;
  v_resumo jsonb;
  v_quem text;
begin
  select * into c from public.caixas where id = p_caixa for update;
  if not found or not public.tem_papel(c.restaurante_id, '{dono,gerente,caixa}') then
    raise exception 'Sem permissão para fechar o caixa';
  end if;
  if c.fechado_em is not null then raise exception 'Este caixa já foi fechado'; end if;
  if exists (select 1 from public.caixa_operadores where restaurante_id = c.restaurante_id and ativo) then
    o := privado.caixa_operador_conferir(c.restaurante_id, p_usuario, p_senha);
  end if;
  v_quem := coalesce(o.nome, public.nome_membro(c.restaurante_id));

  v_resumo := public.caixa_resumo(c.id, now());
  v_resumo := v_resumo || jsonb_build_object(
    'valor_contado', p_valor_contado,
    'diferenca', case when p_valor_contado is null then null
                      else p_valor_contado - (v_resumo ->> 'dinheiro_esperado')::numeric end,
    'fechado_por_nome', v_quem,
    'observacao', nullif(trim(p_obs), '')
  );

  update public.caixas set
    fechado_em = now(),
    fechado_por = (select auth.uid()),
    fechado_por_nome = v_quem,
    fechado_operador_nome = o.nome,
    valor_contado = p_valor_contado,
    observacao = nullif(trim(p_obs), ''),
    resumo = v_resumo
  where id = c.id;

  return v_resumo;
end $$;
grant execute on function public.caixa_abrir(uuid, numeric, text, text), public.caixa_fechar(uuid, numeric, text, text, text),
  public.caixa_operador_salvar(uuid, uuid, text, text, text, boolean), public.caixa_operador_remover(uuid), public.caixa_operadores_qtd(uuid) to authenticated;
revoke execute on function public.caixa_abrir(uuid, numeric, text, text), public.caixa_fechar(uuid, numeric, text, text, text),
  public.caixa_operador_salvar(uuid, uuid, text, text, text, boolean), public.caixa_operador_remover(uuid), public.caixa_operadores_qtd(uuid) from anon, public;

-- Sangria e reforço: registra também o operador do caixa
create or replace function privado.caixa_mov_operador()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.operador_nome is null then
    select operador_nome into new.operador_nome from public.caixas where id = new.caixa_id;
  end if;
  return new;
end $$;
drop trigger if exists caixa_mov_operador on public.caixa_movimentos;
create trigger caixa_mov_operador before insert on public.caixa_movimentos for each row execute function privado.caixa_mov_operador();

-- Gestão de caixas: período com todos os caixas, sangrias e o desempenho de cada operador
create or replace function public.caixas_relatorio(p_rest uuid, p_inicio timestamptz, p_fim timestamptz)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  if not public.tem_papel(p_rest, '{dono,gerente}') then raise exception 'Sem permissão'; end if;
  return jsonb_build_object(
    'caixas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'aberto_em', c.aberto_em, 'fechado_em', c.fechado_em, 'operador_nome', coalesce(c.operador_nome, c.aberto_por_nome),
        'fechado_por_nome', c.fechado_por_nome, 'valor_inicial', c.valor_inicial, 'valor_contado', c.valor_contado, 'observacao', c.observacao,
        'recebido', coalesce((select sum(valor) from public.pagamentos g where g.caixa_id = c.id), 0),
        'dinheiro', coalesce((select sum(valor) from public.pagamentos g where g.caixa_id = c.id and g.forma = 'dinheiro'), 0),
        'retiradas', coalesce((select sum(valor) from public.caixa_movimentos m where m.caixa_id = c.id and m.tipo = 'retirada'), 0),
        'suprimentos', coalesce((select sum(valor) from public.caixa_movimentos m where m.caixa_id = c.id and m.tipo = 'suprimento'), 0),
        'diferenca', (c.resumo ->> 'diferenca')::numeric
      ) order by c.aberto_em desc)
      from public.caixas c
      where c.restaurante_id = p_rest and c.aberto_em >= p_inicio and c.aberto_em < p_fim
    ), '[]'::jsonb),
    'movimentos', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'caixa_id', m.caixa_id, 'tipo', m.tipo, 'valor', m.valor, 'motivo', m.motivo,
        'quem', coalesce(m.operador_nome, m.user_nome), 'criado_em', m.criado_em) order by m.criado_em desc)
      from public.caixa_movimentos m
      where m.restaurante_id = p_rest and m.criado_em >= p_inicio and m.criado_em < p_fim
    ), '[]'::jsonb),
    'por_forma', coalesce((
      select jsonb_object_agg(forma, total) from (
        select g.forma, sum(g.valor) total from public.pagamentos g join public.caixas c on c.id = g.caixa_id
        where c.restaurante_id = p_rest and c.aberto_em >= p_inicio and c.aberto_em < p_fim group by 1) f
    ), '{}'::jsonb)
  );
end $$;
revoke execute on function public.caixas_relatorio(uuid, timestamptz, timestamptz) from anon, public;
grant execute on function public.caixas_relatorio(uuid, timestamptz, timestamptz) to authenticated;

-- Reforço de troco também pela tela (já existia o tipo 'suprimento' no banco)

-- Sangria e reforço mostram o operador do caixa
CREATE OR REPLACE FUNCTION public.caixa_resumo(p_caixa uuid, p_ate timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.caixas;
  v_formas jsonb;
  v_recebido numeric;
  v_dinheiro numeric;
  v_contas int;
  v_retiradas numeric;
  v_suprimentos numeric;
begin
  select * into c from public.caixas where id = p_caixa;
  if not found or not public.eh_membro(c.restaurante_id) then raise exception 'Caixa não encontrado'; end if;

  select coalesce(jsonb_object_agg(forma, total), '{}'::jsonb), coalesce(sum(total), 0), coalesce(sum(n), 0)
  into v_formas, v_recebido, v_contas
  from (
    select forma, sum(valor) as total, count(*) filter (where conta_id is null) as n
    from public.pagamentos where caixa_id = c.id group by forma
  ) f;
  v_dinheiro := coalesce((v_formas ->> 'dinheiro')::numeric, 0);

  select coalesce(sum(valor) filter (where tipo = 'retirada'), 0),
         coalesce(sum(valor) filter (where tipo = 'suprimento'), 0)
  into v_retiradas, v_suprimentos
  from public.caixa_movimentos where caixa_id = c.id;

  return jsonb_build_object(
    'caixa_id', c.id,
    'aberto_em', c.aberto_em,
    'aberto_por_nome', c.aberto_por_nome,
    'valor_inicial', c.valor_inicial,
    'ate', p_ate,
    'vendas', (
      select jsonb_build_object('pedidos', count(*), 'total', coalesce(sum(total), 0))
      from public.pedidos
      where restaurante_id = c.restaurante_id and status <> 'cancelado'
        and criado_em >= c.aberto_em and criado_em < p_ate
    ),
    'cancelados', (
      select jsonb_build_object('pedidos', count(*), 'total', coalesce(sum(total), 0))
      from public.pedidos
      where restaurante_id = c.restaurante_id and status = 'cancelado'
        and criado_em >= c.aberto_em and criado_em < p_ate
    ),
    'recebido', v_recebido,
    'contas_fechadas', v_contas,
    'por_forma', v_formas,
    'retiradas', v_retiradas,
    'suprimentos', v_suprimentos,
    'movimentos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'tipo', m.tipo, 'valor', m.valor, 'motivo', m.motivo,
        'user_nome', coalesce(m.operador_nome, m.user_nome), 'criado_em', m.criado_em
      ) order by m.criado_em)
      from public.caixa_movimentos m where m.caixa_id = c.id
    ), '[]'::jsonb),
    -- Faturamento por tipo de venda e ajustes, dos pedidos pagos neste caixa
    'por_tipo', coalesce((
      select jsonb_object_agg(tipo, total) from (
        select coalesce(p.tipo, 'mesa') as tipo, sum(p.total) as total
        from public.pedidos p join public.pagamentos g on g.id = p.pagamento_id
        where g.caixa_id = c.id and p.status <> 'cancelado' group by 1
      ) t
    ), '{}'::jsonb),
    'ajustes', (
      select jsonb_build_object('descontos', coalesce(sum(p.desconto), 0), 'acrescimos', coalesce(sum(p.acrescimo), 0), 'entregas', coalesce(sum(p.taxa_entrega), 0))
      from public.pedidos p join public.pagamentos g on g.id = p.pagamento_id
      where g.caixa_id = c.id and p.status <> 'cancelado'
    ),
    'dinheiro_esperado', c.valor_inicial + v_dinheiro + v_suprimentos - v_retiradas,
    'em_aberto', (
      select jsonb_build_object('mesas', count(distinct mesa_id), 'total', coalesce(sum(total), 0))
      from public.pedidos
      where restaurante_id = c.restaurante_id and status <> 'cancelado' and pago_em is null
    )
  );
end $function$;
