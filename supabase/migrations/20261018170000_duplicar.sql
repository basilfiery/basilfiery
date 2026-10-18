-- Duplicar item ou categoria (com os itens e subcategorias), para não recadastrar o que é quase igual.
-- A cópia nasce com estoque zerado (estoque só muda pelo histórico) e não esgotada.

create function privado.copiar_produtos(p_de uuid, p_para uuid) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.produtos (restaurante_id, categoria_id, nome, descricao, preco, emoji, imagem_url, vegetariano, picancia,
    destaque, novo, ativo, ordem, controla_estoque, estoque, estoque_minimo, video_url, precisa_preparo, capa, grupo_id, esgotado)
  select restaurante_id, p_para, nome, descricao, preco, emoji, imagem_url, vegetariano, picancia,
    destaque, novo, ativo, ordem, controla_estoque, 0, estoque_minimo, video_url, precisa_preparo, capa, grupo_id, false
  from public.produtos where categoria_id = p_de
$$;

create function public.produto_duplicar(p_produto uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.produtos;
  v_novo uuid;
begin
  select * into v from public.produtos where id = p_produto;
  if not found or not public.tem_papel(v.restaurante_id, '{dono,gerente}') then raise exception 'Sem permissão'; end if;
  insert into public.produtos (restaurante_id, categoria_id, nome, descricao, preco, emoji, imagem_url, vegetariano, picancia,
    destaque, novo, ativo, ordem, controla_estoque, estoque, estoque_minimo, video_url, precisa_preparo, capa, grupo_id, esgotado)
  values (v.restaurante_id, v.categoria_id, left(v.nome || ' (cópia)', 80), v.descricao, v.preco, v.emoji, v.imagem_url, v.vegetariano, v.picancia,
    v.destaque, v.novo, v.ativo, v.ordem, v.controla_estoque, 0, v.estoque_minimo, v.video_url, v.precisa_preparo, v.capa, v.grupo_id, false)
  returning id into v_novo;
  return v_novo;
end $$;

create function public.categoria_duplicar(p_categoria uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.categorias;
  v_sub public.categorias;
  v_nova uuid;
  v_nova_sub uuid;
begin
  select * into v from public.categorias where id = p_categoria;
  if not found or not public.tem_papel(v.restaurante_id, '{dono,gerente}') then raise exception 'Sem permissão'; end if;
  insert into public.categorias (restaurante_id, nome, emoji, ordem, ativo, pai_id, grupo_id, preco_grupo, esgotado)
  values (v.restaurante_id, left(v.nome || ' (cópia)', 60), v.emoji, v.ordem, v.ativo, v.pai_id, v.grupo_id, v.preco_grupo, false)
  returning id into v_nova;
  perform privado.copiar_produtos(v.id, v_nova);
  -- Categoria principal: leva junto as subcategorias e os itens delas
  for v_sub in select * from public.categorias where pai_id = v.id loop
    insert into public.categorias (restaurante_id, nome, emoji, ordem, ativo, pai_id, grupo_id, preco_grupo, esgotado)
    values (v_sub.restaurante_id, v_sub.nome, v_sub.emoji, v_sub.ordem, v_sub.ativo, v_nova, v_sub.grupo_id, v_sub.preco_grupo, false)
    returning id into v_nova_sub;
    perform privado.copiar_produtos(v_sub.id, v_nova_sub);
  end loop;
  return v_nova;
end $$;

revoke execute on function privado.copiar_produtos(uuid, uuid) from public;
revoke execute on function public.produto_duplicar(uuid), public.categoria_duplicar(uuid) from public, anon;
grant execute on function public.produto_duplicar(uuid), public.categoria_duplicar(uuid) to authenticated;
