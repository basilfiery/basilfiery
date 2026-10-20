-- Relatório de itens: quantidade, faturamento (preço cobrado de verdade, com promoção)
-- e lucro estimado (custo de quando foi vendido), por dia da semana.
create or replace function public.relatorio_itens(p_rest uuid, p_inicio timestamptz, p_fim timestamptz, p_tz text default 'America/Sao_Paulo')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_lucro boolean := public.tem_papel(p_rest, '{dono,gerente}');
begin
  if not public.tem_papel(p_rest, '{dono,gerente,caixa}') then raise exception 'Sem permissão'; end if;
  if p_fim <= p_inicio then raise exception 'Período inválido'; end if;
  if p_fim - p_inicio > interval '400 days' then raise exception 'Escolha um período de até 1 ano'; end if;
  perform now() at time zone p_tz;

  return jsonb_build_object(
    've_lucro', v_lucro,
    'linhas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nome', z.nome, 'dia', z.dia, 'qtd', z.qtd, 'faturamento', z.fat,
        'preco_min', z.pmin, 'preco_max', z.pmax,
        'custo', case when v_lucro then z.cus end,
        'qtd_sem_custo', case when v_lucro then z.sem end
      ) order by z.nome, z.dia)
      from (
        select i.nome,
          extract(dow from p.criado_em at time zone p_tz)::int as dia,
          sum(i.qtd) as qtd,
          sum(i.preco_unit * i.qtd) as fat,
          min(i.preco_unit) as pmin,
          max(i.preco_unit) as pmax,
          sum(coalesce(i.custo_unit, pr.custo, 0) * i.qtd) as cus,
          sum(case when coalesce(i.custo_unit, pr.custo) is null then i.qtd else 0 end) as sem
        from public.pedido_itens i
        join public.pedidos p on p.id = i.pedido_id
        left join public.produtos pr on pr.id = i.produto_id
        where p.restaurante_id = p_rest and p.criado_em >= p_inicio and p.criado_em < p_fim and p.status <> 'cancelado'
        group by i.nome, 2
      ) z
    ), '[]'::jsonb)
  );
end $$;
revoke all on function public.relatorio_itens(uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.relatorio_itens(uuid, timestamptz, timestamptz, text) to authenticated;
