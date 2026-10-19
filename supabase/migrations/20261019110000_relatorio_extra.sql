-- Relatório: pedidos por forma de pagamento e por tipo, taxas de entrega e descontos do período
create or replace function public.relatorio_extra(p_rest uuid, p_inicio timestamptz, p_fim timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if not public.tem_papel(p_rest, '{dono,gerente,caixa}') then
    raise exception 'Sem permissão para ver relatórios';
  end if;
  if p_fim <= p_inicio then raise exception 'Período inválido'; end if;

  with val as (
    select p.total, coalesce(p.tipo, 'mesa') as tipo, coalesce(p.taxa_entrega, 0) as taxa, coalesce(p.desconto, 0) as desconto,
           case when p.pago_em is null then 'aberto' else coalesce(pg.forma, p.forma_pagamento, 'outro') end as forma
    from public.pedidos p
    left join public.pagamentos pg on pg.id = p.pagamento_id
    where p.restaurante_id = p_rest and p.criado_em >= p_inicio and p.criado_em < p_fim and p.status <> 'cancelado'
  )
  select jsonb_build_object(
    'por_forma', coalesce((select jsonb_agg(x order by x.receita desc) from (select forma, count(*) as pedidos, sum(total) as receita from val group by forma) x), '[]'::jsonb),
    'por_tipo', coalesce((select jsonb_agg(x order by x.receita desc) from (select tipo, count(*) as pedidos, sum(total) as receita from val group by tipo) x), '[]'::jsonb),
    'taxas', coalesce((select sum(taxa) from val), 0),
    'descontos', coalesce((select sum(desconto) from val), 0)
  ) into v;
  return v;
end $$;

revoke execute on function public.relatorio_extra(uuid, timestamptz, timestamptz) from public;
grant execute on function public.relatorio_extra(uuid, timestamptz, timestamptz) to authenticated;
