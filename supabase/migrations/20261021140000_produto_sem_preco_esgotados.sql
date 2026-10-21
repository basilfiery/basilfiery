-- 1) Produto a R$ 0,00 fica indisponível (menos quando o preço vem da subcategoria de tamanho,
--    dos sabores ou de um adicional obrigatório).
-- 2) A loja escolhe se os esgotados aparecem em cinza no cardápio do cliente ou somem.

alter table public.restaurantes add column if not exists esgotados_modo text not null default 'mostrar'
  check (esgotados_modo in ('mostrar', 'ocultar'));
grant update (esgotados_modo) on public.restaurantes to authenticated;

CREATE OR REPLACE FUNCTION privado.cardapio_json(p_rest uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with prod as (
    select p.*, c.esgotado as cat_esgotada,
      -- Preço zerado sem outra fonte de preço: não pode ser vendido
      (p.preco <= 0 and c.preco_grupo is null and c.grupo_id is null
        and not exists (select 1 from public.produto_adicionais pa join public.adicional_grupos g on g.id = pa.grupo_id
                        where pa.produto_id = p.id and g.minimo >= 1)) as sem_preco
    from public.produtos p
    join public.categorias c on c.id = p.categoria_id and c.ativo
    left join public.categorias pai on pai.id = c.pai_id
    where p.restaurante_id = p_rest and p.ativo and (c.pai_id is null or pai.ativo)
  )
  select jsonb_build_object(
    'ocultar_esgotados', coalesce((select r.esgotados_modo = 'ocultar' from public.restaurantes r where r.id = p_rest), false),
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'nome', c.nome, 'emoji', c.emoji, 'pai_id', c.pai_id,
        'grupo_id', c.grupo_id, 'preco_grupo', c.preco_grupo, 'esgotado', c.esgotado
      ) order by c.ordem, c.nome)
      from public.categorias c
      left join public.categorias pai on pai.id = c.pai_id
      where c.restaurante_id = p_rest and c.ativo and (c.pai_id is null or pai.ativo)
    ), '[]'::jsonb),
    'produtos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'categoria_id', p.categoria_id, 'nome', p.nome, 'descricao', p.descricao,
        'preco', p.preco, 'preco_de', case when p.preco_de > p.preco then p.preco_de end,
        'galeria', p.galeria, 'dica_obs', p.dica_obs,
        'emoji', p.emoji, 'imagem_url', p.imagem_url, 'video_url', p.video_url,
        'capa', case when p.capa = 'video' and p.video_url is not null then 'video' else 'imagem' end,
        'vegetariano', p.vegetariano, 'picancia', p.picancia, 'destaque', p.destaque, 'novo', p.novo,
        'disponivel', not p.sem_preco and not p.esgotado and not p.cat_esgotada and ((not p.controla_estoque) or p.estoque > 0),
        'motivo', case when p.sem_preco then 'sem_preco'
                       when p.esgotado or p.cat_esgotada or (p.controla_estoque and p.estoque <= 0) then 'esgotado' end,
        'estoque_max', case when p.controla_estoque then p.estoque end
      ) order by p.ordem, p.nome)
      from prod p
    ), '[]'::jsonb),
    'sabores', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'grupo_id', p.grupo_id, 'nome', p.nome, 'descricao', p.descricao,
        'preco', p.preco, 'emoji', p.emoji, 'imagem_url', p.imagem_url, 'video_url', p.video_url,
        'capa', case when p.capa = 'video' and p.video_url is not null then 'video' else 'imagem' end,
        'vegetariano', p.vegetariano, 'picancia', p.picancia, 'destaque', false, 'novo', p.novo,
        'disponivel', not p.esgotado and ((not p.controla_estoque) or p.estoque > 0),
        'estoque_max', case when p.controla_estoque then p.estoque end
      ) order by p.ordem, p.nome)
      from public.produtos p
      where p.restaurante_id = p_rest and p.ativo and p.grupo_id is not null
    ), '[]'::jsonb)
  ) || privado.adicionais_json(p_rest)
$function$;
