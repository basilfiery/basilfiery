-- Retiradas (sangria) e reforços de troco no caixa aberto

create table public.caixa_movimentos (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  caixa_id uuid not null references public.caixas on delete cascade,
  tipo text not null check (tipo in ('retirada', 'suprimento')),
  valor numeric(10,2) not null check (valor > 0),
  motivo text,
  user_id uuid references auth.users on delete set null default auth.uid(),
  user_nome text,
  criado_em timestamptz not null default now()
);
create index on public.caixa_movimentos (caixa_id);
create index on public.caixa_movimentos (restaurante_id, criado_em desc);
create index on public.caixa_movimentos (user_id);

alter table public.caixa_movimentos enable row level security;
revoke all on public.caixa_movimentos from anon;
revoke insert, update, delete on public.caixa_movimentos from authenticated;
create policy "ver movimentos do caixa" on public.caixa_movimentos for select to authenticated
  using (public.eh_membro(restaurante_id));

-- Resumo passa a considerar retiradas e reforços no dinheiro esperado
create or replace function public.caixa_resumo(p_caixa uuid, p_ate timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
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
    select forma, sum(valor) as total, count(*) as n
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
        'user_nome', m.user_nome, 'criado_em', m.criado_em
      ) order by m.criado_em)
      from public.caixa_movimentos m where m.caixa_id = c.id
    ), '[]'::jsonb),
    'dinheiro_esperado', c.valor_inicial + v_dinheiro + v_suprimentos - v_retiradas,
    'em_aberto', (
      select jsonb_build_object('mesas', count(distinct mesa_id), 'total', coalesce(sum(total), 0))
      from public.pedidos
      where restaurante_id = c.restaurante_id and status <> 'cancelado' and pago_em is null
    )
  );
end $$;

-- Registra uma retirada (sangria) ou reforço de troco no caixa aberto
create function public.caixa_movimentar(p_caixa uuid, p_tipo text, p_valor numeric, p_motivo text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  c public.caixas;
  v_disponivel numeric;
  v_id uuid;
begin
  select * into c from public.caixas where id = p_caixa for update;
  if not found or not public.tem_papel(c.restaurante_id, '{dono,gerente,caixa}') then
    raise exception 'Sem permissão para movimentar o caixa';
  end if;
  if c.fechado_em is not null then raise exception 'Este caixa já foi fechado'; end if;
  if p_tipo not in ('retirada', 'suprimento') then raise exception 'Tipo de movimento inválido'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe um valor maior que zero'; end if;

  if p_tipo = 'retirada' then
    v_disponivel := (public.caixa_resumo(c.id, now()) ->> 'dinheiro_esperado')::numeric;
    if p_valor > v_disponivel then
      raise exception 'A retirada é maior que o dinheiro esperado na gaveta (R$ %)', replace(to_char(v_disponivel, 'FM999990.00'), '.', ',');
    end if;
  end if;

  insert into public.caixa_movimentos (restaurante_id, caixa_id, tipo, valor, motivo, user_nome)
  values (c.restaurante_id, c.id, p_tipo, round(p_valor, 2), nullif(trim(p_motivo), ''), public.nome_membro(c.restaurante_id))
  returning id into v_id;

  return public.caixa_resumo(c.id, now()) || jsonb_build_object('movimento_id', v_id);
end $$;

revoke execute on function public.caixa_movimentar(uuid, text, numeric, text) from public, anon;
grant execute on function public.caixa_movimentar(uuid, text, numeric, text) to authenticated;

-- Atualiza o painel dos outros computadores quando houver retirada
alter publication supabase_realtime add table public.caixa_movimentos;
