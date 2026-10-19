-- Contas de clientes no cardápio digital + custo dos produtos e lucro

-- ============ Clientes com conta (e-mail/senha ou Google) ============
create table if not exists public.clientes_perfis (
  user_id uuid primary key references auth.users on delete cascade,
  nome text check (char_length(nome) <= 80),
  telefone text check (char_length(telefone) <= 20),
  enderecos jsonb not null default '[]'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.clientes_perfis enable row level security;
drop policy if exists "cliente vê o próprio perfil" on public.clientes_perfis;
drop policy if exists "cliente cria o próprio perfil" on public.clientes_perfis;
drop policy if exists "cliente edita o próprio perfil" on public.clientes_perfis;
create policy "cliente vê o próprio perfil" on public.clientes_perfis for select to authenticated using (user_id = auth.uid());
create policy "cliente cria o próprio perfil" on public.clientes_perfis for insert to authenticated with check (user_id = auth.uid());
create policy "cliente edita o próprio perfil" on public.clientes_perfis for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.clientes_perfis to authenticated;

alter table public.pedidos add column if not exists cliente_user_id uuid references auth.users on delete set null;
create index if not exists pedidos_cliente_user on public.pedidos (cliente_user_id, criado_em desc) where cliente_user_id is not null;

-- Pedido do cardápio digital fica ligado à conta de quem está logado
CREATE OR REPLACE FUNCTION public.loja_pedido_enviar(p_codigo text, p_tipo text, p_itens jsonb, p_cliente jsonb, p_obs text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rest public.restaurantes;
  v_todas jsonb;
  v_preparo boolean;
  v_itens_total numeric(10,2);
  v_taxa numeric(10,2) := 0;
  v_numero int;
  v_pedido uuid;
  v_acompanhar text := replace(gen_random_uuid()::text, '-', '');
  v_cli_nome text := nullif(left(trim(p_cliente ->> 'nome'), 80), '');
  v_cli_tel text := nullif(regexp_replace(coalesce(p_cliente ->> 'telefone', ''), '\D', '', 'g'), '');
  v_forma text := p_cliente ->> 'pagamento';
  v_troco numeric(10,2) := nullif(p_cliente ->> 'troco', '')::numeric;
  v_end jsonb := null;
  v_lat float8;
  v_lng float8;
  v_dist numeric;
begin
  select * into v_rest from public.restaurantes where codigo = lower(trim(p_codigo));
  if not found or not v_rest.ativo then raise exception 'Loja não encontrada'; end if;
  if not privado.loja_aberta(v_rest) then raise exception 'A loja está fechada para pedidos agora'; end if;
  if p_tipo not in ('delivery', 'retirada') then raise exception 'Escolha entrega ou retirada'; end if;
  if p_tipo = 'delivery' and not v_rest.entrega_ativa then raise exception 'Esta loja não faz entrega agora'; end if;
  if p_tipo = 'retirada' and not v_rest.retirada_ativa then raise exception 'Esta loja não faz retirada no balcão'; end if;
  if v_cli_nome is null then raise exception 'Informe seu nome'; end if;
  if v_cli_tel is null or char_length(v_cli_tel) not between 10 and 13 then raise exception 'Informe um telefone com DDD'; end if;
  if v_forma is null or not (v_forma = any (v_rest.formas_pagamento)) then raise exception 'Escolha a forma de pagamento'; end if;
  if jsonb_typeof(p_itens) = 'array' and jsonb_array_length(p_itens) > 50 then raise exception 'Itens demais em um só pedido'; end if;
  if (select count(*) from public.pedidos where restaurante_id = v_rest.id and cliente_telefone = v_cli_tel
      and criado_em > now() - interval '30 minutes' and status in ('novo', 'preparando')) >= 3 then
    raise exception 'Você já tem pedidos em andamento. Aguarde ou fale com a loja.';
  end if;
  if p_tipo = 'delivery' then
    if nullif(trim(p_cliente -> 'endereco' ->> 'rua'), '') is null or nullif(trim(p_cliente -> 'endereco' ->> 'numero'), '') is null
       or nullif(trim(p_cliente -> 'endereco' ->> 'bairro'), '') is null then
      raise exception 'Informe rua, número e bairro para a entrega';
    end if;
    v_end := jsonb_build_object(
      'rua', left(trim(p_cliente -> 'endereco' ->> 'rua'), 120),
      'numero', left(trim(p_cliente -> 'endereco' ->> 'numero'), 20),
      'bairro', left(trim(p_cliente -> 'endereco' ->> 'bairro'), 80),
      'complemento', nullif(left(trim(coalesce(p_cliente -> 'endereco' ->> 'complemento', '')), 80), ''),
      'referencia', nullif(left(trim(coalesce(p_cliente -> 'endereco' ->> 'referencia', '')), 120), '')
    );
    -- Taxa: fixa, por bairro ou por distância (raio a partir da loja)
    if v_rest.entrega_modo = 'bairro' then
      v_taxa := null;
      select (b ->> 'taxa')::numeric into v_taxa from jsonb_array_elements(v_rest.entrega_bairros) b
      where lower(trim(b ->> 'nome')) = lower(trim(p_cliente -> 'endereco' ->> 'bairro')) limit 1;
      if v_taxa is null then raise exception 'A loja não entrega no bairro "%"', trim(p_cliente -> 'endereco' ->> 'bairro'); end if;
    elsif v_rest.entrega_modo = 'raio' then
      v_lat := nullif(p_cliente -> 'endereco' ->> 'lat', '')::float8;
      v_lng := nullif(p_cliente -> 'endereco' ->> 'lng', '')::float8;
      if v_lat is null or v_lng is null or v_rest.lat is null then raise exception 'Confirme a localização do endereço para calcular a entrega'; end if;
      v_dist := round((6371 * 2 * asin(sqrt(
        power(sin(radians(v_lat - v_rest.lat) / 2), 2) +
        cos(radians(v_rest.lat)) * cos(radians(v_lat)) * power(sin(radians(v_lng - v_rest.lng) / 2), 2))))::numeric, 2);
      v_taxa := null;
      select (r ->> 'taxa')::numeric into v_taxa from jsonb_array_elements(v_rest.entrega_raios) r
      where (r ->> 'ate_km')::numeric >= v_dist order by (r ->> 'ate_km')::numeric limit 1;
      if v_taxa is null then raise exception 'Endereço fora da área de entrega (% km da loja)', replace(v_dist::text, '.', ','); end if;
      v_end := v_end || jsonb_build_object('lat', v_lat, 'lng', v_lng, 'distancia_km', v_dist);
    else
      v_taxa := v_rest.delivery_taxa;
    end if;
  end if;

  -- Loja que desligou a observação: ignora o que vier
  if not v_rest.loja_obs and jsonb_typeof(p_itens) = 'array' then
    select jsonb_agg(e - 'obs') into p_itens from jsonb_array_elements(p_itens) e;
  end if;
  v_todas := privado.precificar(v_rest.id, p_itens);
  select coalesce(sum((l ->> 'preco')::numeric * (l ->> 'qtd')::int), 0), coalesce(bool_or((l ->> 'preparo')::boolean), false)
  into v_itens_total, v_preparo from jsonb_array_elements(v_todas) l;

  if v_itens_total < v_rest.delivery_minimo then
    raise exception 'O pedido mínimo é de R$ %', replace(to_char(v_rest.delivery_minimo, 'FM999990.00'), '.', ',');
  end if;
  if v_forma = 'dinheiro' and v_troco is not null and v_troco < v_itens_total + v_taxa then v_troco := null; end if;

  update public.restaurantes set ultimo_pedido = ultimo_pedido + 1 where id = v_rest.id returning ultimo_pedido into v_numero;

  insert into public.pedidos (restaurante_id, mesa_id, mesa_nome, numero, observacao, total, precisa_preparo,
    tipo, cliente_nome, cliente_telefone, endereco, forma_pagamento, troco_para, taxa_entrega, acompanhar, cliente_user_id)
  values (v_rest.id, null, case when p_tipo = 'delivery' then 'Delivery' else 'Retirada' end, v_numero,
    case when v_rest.loja_obs then nullif(left(trim(p_obs), 300), '') end, v_itens_total + v_taxa, v_preparo,
    p_tipo, v_cli_nome, v_cli_tel, v_end, v_forma, case when v_forma = 'dinheiro' then v_troco end, v_taxa, v_acompanhar, auth.uid())
  returning id into v_pedido;

  insert into public.pedido_itens (pedido_id, restaurante_id, produto_id, nome, preco_unit, qtd, obs, complementos, adicionais)
  select v_pedido, v_rest.id, (l ->> 'produto_id')::uuid, l ->> 'nome', (l ->> 'preco')::numeric, (l ->> 'qtd')::int, l ->> 'obs',
    l ->> 'complementos', l -> 'adicionais'
  from jsonb_array_elements(v_todas) l;

  insert into public.movimentos_estoque (restaurante_id, produto_id, delta, motivo, pedido_id, user_id)
  select v_rest.id, (l ->> 'produto_id')::uuid, -((l ->> 'qtd')::int), 'Pedido #' || v_numero, v_pedido, null
  from jsonb_array_elements(v_todas) l where (l ->> 'controla')::boolean;

  perform privado.enviar_conversao(v_pedido, p_cliente ->> 'ua', p_cliente ->> 'url');

  return jsonb_build_object('numero', v_numero, 'acompanhar', v_acompanhar, 'total', v_itens_total + v_taxa);
end $function$;

-- Pedidos do cliente logado nesta loja (para acompanhar e pedir de novo)
create or replace function public.cliente_meus_pedidos(p_codigo text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x.criado_em desc), '[]'::jsonb) from (
    select p.numero, p.status, p.tipo, p.total, p.criado_em, p.acompanhar, p.taxa_entrega as taxa,
      (select jsonb_agg(jsonb_build_object('produto_id', i.produto_id, 'nome', i.nome, 'qtd', i.qtd, 'preco', i.preco_unit,
                                          'obs', i.obs, 'complementos', i.complementos, 'adicionais', i.adicionais) order by i.nome)
       from public.pedido_itens i where i.pedido_id = p.id) as itens
    from public.pedidos p join public.restaurantes r on r.id = p.restaurante_id
    where auth.uid() is not null and p.cliente_user_id = auth.uid() and r.codigo = lower(trim(p_codigo))
    order by p.criado_em desc
    limit 30
  ) x
$$;
revoke execute on function public.cliente_meus_pedidos(text) from public;
grant execute on function public.cliente_meus_pedidos(text) to authenticated;

-- ============ Custo dos produtos ============
alter table public.produtos add column if not exists custo numeric(10,2) check (custo is null or custo >= 0);
grant select (custo), insert (custo), update (custo) on public.produtos to authenticated;
alter table public.pedido_itens add column if not exists custo_unit numeric(10,2);

-- Cada item vendido guarda o custo do momento (mudar o custo depois não altera vendas antigas)
create or replace function privado.item_custo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.custo_unit is null and new.produto_id is not null then
    select p.custo into new.custo_unit from public.produtos p where p.id = new.produto_id;
  end if;
  return new;
end $$;
drop trigger if exists item_custo on public.pedido_itens;
create trigger item_custo before insert on public.pedido_itens for each row execute function privado.item_custo();

-- Lucro do período: receita dos produtos − descontos − custo (taxa de entrega fica de fora)
create or replace function public.relatorio_lucro(p_rest uuid, p_inicio timestamptz, p_fim timestamptz, p_tz text default 'America/Sao_Paulo')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if not public.tem_papel(p_rest, '{dono,gerente}') then raise exception 'Só o dono e o gerente veem o lucro'; end if;
  if p_fim <= p_inicio then raise exception 'Período inválido'; end if;
  if p_fim - p_inicio > interval '400 days' then raise exception 'Escolha um período de até 1 ano'; end if;
  perform now() at time zone p_tz;

  with ped as (
    select p.id, p.criado_em, coalesce(p.desconto, 0) as desconto
    from public.pedidos p
    where p.restaurante_id = p_rest and p.criado_em >= p_inicio and p.criado_em < p_fim and p.status <> 'cancelado'
  ), it as (
    select ped.criado_em, i.nome, i.qtd, i.preco_unit * i.qtd as receita,
           coalesce(i.custo_unit, pr.custo) as custo_unit
    from public.pedido_itens i
    join ped on ped.id = i.pedido_id
    left join public.produtos pr on pr.id = i.produto_id
  )
  select jsonb_build_object(
    'receita', coalesce((select sum(receita) from it), 0),
    'descontos', coalesce((select sum(desconto) from ped), 0),
    'custo', coalesce((select sum(custo_unit * qtd) from it where custo_unit is not null), 0),
    'itens_sem_custo', coalesce((select sum(qtd) from it where custo_unit is null), 0),
    'produtos_sem_custo', coalesce((select jsonb_agg(distinct nome) from it where custo_unit is null), '[]'::jsonb),
    'por_dia', coalesce((
      select jsonb_agg(jsonb_build_object('dia', d.dia, 'receita', d.rec, 'custo', d.cus,
             'lucro', d.rec - d.cus - coalesce((select sum(desconto) from ped where (ped.criado_em at time zone p_tz)::date = d.dia), 0)) order by d.dia)
      from (
        select (criado_em at time zone p_tz)::date as dia, sum(receita) as rec, sum(coalesce(custo_unit, 0) * qtd) as cus
        from it group by 1
      ) d
    ), '[]'::jsonb),
    'por_produto', coalesce((
      select jsonb_agg(jsonb_build_object('nome', z.nome, 'qtd', z.q, 'receita', z.rec, 'custo', z.cus, 'lucro', z.rec - z.cus, 'tem_custo', z.tem) order by (z.rec - z.cus) desc)
      from (
        select nome, sum(qtd) as q, sum(receita) as rec, sum(coalesce(custo_unit, 0) * qtd) as cus, bool_and(custo_unit is not null) as tem
        from it group by nome
      ) z
    ), '[]'::jsonb)
  ) into v;
  return v || jsonb_build_object('lucro', (v ->> 'receita')::numeric - (v ->> 'descontos')::numeric - (v ->> 'custo')::numeric);
end $$;
revoke execute on function public.relatorio_lucro(uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.relatorio_lucro(uuid, timestamptz, timestamptz, text) to authenticated;
