-- Relatórios de vendas (calculados no banco: rápidos mesmo com muitos pedidos)
-- Vendas = pedidos não cancelados. Datas agrupadas no fuso do restaurante.

create function public.relatorio_vendas(
  p_rest uuid,
  p_inicio timestamptz,
  p_fim timestamptz,
  p_tz text default 'America/Sao_Paulo'
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if not public.tem_papel(p_rest, '{dono,gerente,caixa}') then
    raise exception 'Sem permissão para ver relatórios';
  end if;
  if p_fim <= p_inicio then raise exception 'Período inválido'; end if;
  if p_fim - p_inicio > interval '400 days' then raise exception 'Escolha um período de até 1 ano'; end if;
  perform now() at time zone p_tz; -- valida o fuso

  with ped as (
    select p.id, p.mesa_nome, p.status, p.total, p.criado_em, p.pago_em
    from public.pedidos p
    where p.restaurante_id = p_rest and p.criado_em >= p_inicio and p.criado_em < p_fim
  ),
  val as (select * from ped where status <> 'cancelado'),
  itens as (
    select i.nome, i.qtd, i.preco_unit, pr.categoria_id
    from public.pedido_itens i
    join val on val.id = i.pedido_id
    left join public.produtos pr on pr.id = i.produto_id
  )
  select jsonb_build_object(
    'resumo', (
      select jsonb_build_object(
        'faturamento', coalesce(sum(total), 0),
        'pedidos', count(*),
        'ticket_medio', coalesce(round(avg(total), 2), 0),
        'itens', (select coalesce(sum(qtd), 0) from itens),
        'mesas_atendidas', count(distinct mesa_nome),
        'recebido', coalesce(sum(total) filter (where pago_em is not null), 0),
        'em_aberto', coalesce(sum(total) filter (where pago_em is null), 0)
      ) from val
    ),
    'cancelados', (
      select jsonb_build_object('pedidos', count(*), 'valor', coalesce(sum(total), 0))
      from ped where status = 'cancelado'
    ),
    'por_dia', coalesce((
      select jsonb_agg(jsonb_build_object('dia', dia, 'faturamento', fat, 'pedidos', n) order by dia)
      from (
        select (criado_em at time zone p_tz)::date as dia, sum(total) as fat, count(*) as n
        from val group by 1
      ) d
    ), '[]'::jsonb),
    'por_hora', coalesce((
      select jsonb_agg(jsonb_build_object('hora', hora, 'faturamento', fat, 'pedidos', n) order by hora)
      from (
        select extract(hour from criado_em at time zone p_tz)::int as hora, sum(total) as fat, count(*) as n
        from val group by 1
      ) h
    ), '[]'::jsonb),
    'top_produtos', coalesce((
      select jsonb_agg(jsonb_build_object('nome', nome, 'qtd', qtd, 'faturamento', fat) order by fat desc, qtd desc)
      from (
        select nome, sum(qtd) as qtd, sum(qtd * preco_unit) as fat
        from itens group by nome order by fat desc, qtd desc limit 15
      ) t
    ), '[]'::jsonb),
    'por_categoria', coalesce((
      select jsonb_agg(jsonb_build_object('categoria', coalesce(c.nome, 'Sem categoria'), 'qtd', t.qtd, 'faturamento', t.fat) order by t.fat desc)
      from (
        select categoria_id, sum(qtd) as qtd, sum(qtd * preco_unit) as fat
        from itens group by categoria_id
      ) t
      left join public.categorias c on c.id = t.categoria_id
    ), '[]'::jsonb),
    'por_mesa', coalesce((
      select jsonb_agg(jsonb_build_object('mesa', mesa_nome, 'pedidos', n, 'faturamento', fat) order by fat desc)
      from (
        select mesa_nome, count(*) as n, sum(total) as fat
        from val group by mesa_nome order by fat desc limit 10
      ) m
    ), '[]'::jsonb)
  ) into v;

  return v;
end $$;

create function public.relatorio_meses(
  p_rest uuid,
  p_meses int default 12,
  p_tz text default 'America/Sao_Paulo'
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
  v_atual timestamp;
  v_qtd int := least(greatest(coalesce(p_meses, 12), 1), 36);
begin
  if not public.tem_papel(p_rest, '{dono,gerente,caixa}') then
    raise exception 'Sem permissão para ver relatórios';
  end if;
  v_atual := date_trunc('month', now() at time zone p_tz);

  select coalesce(jsonb_agg(jsonb_build_object(
           'mes', to_char(m.mes, 'YYYY-MM'),
           'faturamento', coalesce(x.fat, 0),
           'pedidos', coalesce(x.n, 0)
         ) order by m.mes), '[]'::jsonb)
  into v
  from generate_series(v_atual - make_interval(months => v_qtd - 1), v_atual, interval '1 month') as m(mes)
  left join (
    select date_trunc('month', criado_em at time zone p_tz) as mes, sum(total) as fat, count(*) as n
    from public.pedidos
    where restaurante_id = p_rest
      and status <> 'cancelado'
      and criado_em >= (v_atual - make_interval(months => v_qtd - 1)) at time zone p_tz
    group by 1
  ) x on x.mes = m.mes;

  return v;
end $$;

revoke execute on function public.relatorio_vendas(uuid, timestamptz, timestamptz, text) from public, anon;
revoke execute on function public.relatorio_meses(uuid, int, text) from public, anon;
grant execute on function public.relatorio_vendas(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.relatorio_meses(uuid, int, text) to authenticated;
