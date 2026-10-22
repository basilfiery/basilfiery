-- Order bump: quantas unidades de cada item da oferta o cliente pode levar (1 = sem botão de quantidade)
alter table public.order_bumps add column if not exists max_qtd int not null default 1 check (max_qtd between 1 and 10);

create or replace function privado.bumps_json(p_rest uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'bumps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'titulo', b.titulo, 'subtitulo', b.subtitulo, 'gatilho', b.gatilho,
        'categorias', b.gatilho_categorias, 'produtos', b.gatilho_produtos, 'palavras', b.gatilho_palavras,
        'ofertas_modo', b.ofertas_modo, 'ofertas', b.ofertas, 'max_ofertas', b.max_ofertas, 'max_qtd', b.max_qtd,
        'desconto_tipo', b.desconto_tipo, 'desconto_valor', b.desconto_valor, 'canais', b.canais
      ) order by b.prioridade, b.criado_em)
      from public.order_bumps b where b.restaurante_id = p_rest and b.ativo
    ), '[]'::jsonb),
    'bump_auto', case
      when exists (select 1 from public.order_bumps b where b.restaurante_id = p_rest and b.ativo and (b.ofertas_modo = 'automatico' or b.gatilho = 'automatico'))
      then privado.bump_sugestoes(p_rest) else '{}'::jsonb end
  )
$$;

-- O servidor respeita o limite de unidades da oferta
do $$
declare d text;
begin
  d := pg_get_functiondef('privado.precificar(uuid, jsonb)'::regprocedure);
  if position('v_bump.max_qtd' in d) = 0 then
    d := replace(d, $a$or v_qtd > 20 then raise exception 'Oferta inválida'; end if;$a$,
      $a$then raise exception 'Oferta inválida'; end if;
      if v_qtd > v_bump.max_qtd then
        raise exception 'A oferta de "%" vale para até % %', v_prod.nome, v_bump.max_qtd, case when v_bump.max_qtd = 1 then 'unidade' else 'unidades' end;
      end if;$a$);
    if position('v_bump.max_qtd' in d) = 0 then raise exception 'precificar: trecho não encontrado'; end if;
    execute d;
  end if;
end $$;
