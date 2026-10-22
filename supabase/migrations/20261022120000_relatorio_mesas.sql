-- Relatório "Mesas e comandas": cada conta de mesa fechada no caixa é uma comanda
-- (pagamento + os pedidos dela). Também mostra as comandas que ainda estão abertas.

create or replace function public.relatorio_mesas(p_rest uuid, p_inicio timestamptz, p_fim timestamptz, p_tz text default 'America/Sao_Paulo')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.tem_papel(p_rest, '{dono,gerente,caixa}') then raise exception 'Sem permissão'; end if;
  if p_fim <= p_inicio then raise exception 'Período inválido'; end if;
  if p_fim - p_inicio > interval '400 days' then raise exception 'Escolha um período de até 1 ano'; end if;
  perform now() at time zone p_tz;

  return (
    with fechadas as (
      select g.id, g.mesa_id, g.mesa_nome, g.forma, g.criado_em as fechada_em,
             min(p.criado_em) as aberta_em,
             count(p.id) as pedidos,
             coalesce(sum(p.total), 0) as total,
             coalesce((select sum(i.qtd) from public.pedido_itens i where i.pedido_id = any (array_agg(p.id))), 0) as itens
      from public.pagamentos g
      join public.pedidos p on p.pagamento_id = g.id and p.status <> 'cancelado'
      where g.restaurante_id = p_rest and g.mesa_id is not null
        and g.criado_em >= p_inicio and g.criado_em < p_fim
      group by g.id
    ),
    abertas as (
      select p.mesa_id, max(p.mesa_nome) as mesa_nome, min(p.criado_em) as aberta_em,
             count(*) as pedidos, sum(p.total) as total,
             coalesce((select sum(i.qtd) from public.pedido_itens i where i.pedido_id = any (array_agg(p.id))), 0) as itens
      from public.pedidos p
      where p.restaurante_id = p_rest and p.mesa_id is not null and p.pago_em is null and p.status <> 'cancelado'
      group by p.mesa_id
    )
    select jsonb_build_object(
      'resumo', (select jsonb_build_object(
          'comandas', count(*),
          'faturamento', coalesce(sum(total), 0),
          'ticket_medio', coalesce(round(avg(total), 2), 0),
          'pedidos', coalesce(sum(pedidos), 0),
          'itens', coalesce(sum(itens), 0),
          'minutos_medio', coalesce(round(avg(extract(epoch from fechada_em - aberta_em) / 60)), 0),
          'mesas_usadas', count(distinct mesa_id)
        ) from fechadas),
      'abertas_resumo', (select jsonb_build_object('comandas', count(*), 'total', coalesce(sum(total), 0)) from abertas),
      'por_mesa', coalesce((
        select jsonb_agg(jsonb_build_object(
          'mesa', x.mesa_nome, 'comandas', x.comandas, 'pedidos', x.pedidos, 'itens', x.itens,
          'faturamento', x.fat, 'ticket_medio', round(x.fat / greatest(x.comandas, 1), 2), 'minutos_medio', x.minutos
        ) order by x.fat desc, x.mesa_nome)
        from (
          select max(f.mesa_nome) as mesa_nome, count(*) as comandas, sum(f.pedidos) as pedidos, sum(f.itens) as itens,
                 sum(f.total) as fat, round(avg(extract(epoch from f.fechada_em - f.aberta_em) / 60)) as minutos
          from fechadas f group by f.mesa_id
        ) x
      ), '[]'::jsonb),
      'por_hora', coalesce((
        select jsonb_agg(jsonb_build_object('hora', h.hora, 'comandas', h.qtd) order by h.hora)
        from (select extract(hour from f.aberta_em at time zone p_tz)::int as hora, count(*) as qtd from fechadas f group by 1) h
      ), '[]'::jsonb),
      'comandas', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', f.id, 'mesa', f.mesa_nome, 'aberta_em', f.aberta_em, 'fechada_em', f.fechada_em,
          'pedidos', f.pedidos, 'itens', f.itens, 'total', f.total, 'forma', f.forma
        ) order by f.fechada_em desc)
        from (select * from fechadas order by fechada_em desc limit 500) f
      ), '[]'::jsonb),
      'abertas', coalesce((
        select jsonb_agg(jsonb_build_object(
          'mesa', a.mesa_nome, 'aberta_em', a.aberta_em, 'pedidos', a.pedidos, 'itens', a.itens, 'total', a.total
        ) order by a.aberta_em)
        from abertas a
      ), '[]'::jsonb)
    )
  );
end $$;

revoke all on function public.relatorio_mesas(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.relatorio_mesas(uuid, timestamptz, timestamptz, text) to authenticated;
