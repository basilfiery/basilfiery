-- Fechamento de caixa detalhado (como o do Anota AI): faturamento por tipo de venda,
-- descontos, acréscimos e entregas. Conta dividida conta como uma conta só.
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
        'user_nome', m.user_nome, 'criado_em', m.criado_em
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
end $$;

