-- Itens que não passam pela cozinha (bebidas, itens prontos) pulam a etapa "Em preparo"

alter table public.produtos add column precisa_preparo boolean not null default true;
grant update (precisa_preparo) on public.produtos to authenticated;

-- Ponto de partida: produtos de categorias de bebida não vão para a cozinha
update public.produtos p set precisa_preparo = false
from public.categorias c
where c.id = p.categoria_id
  and c.nome ilike any (array['%bebida%', '%drink%', '%refri%', '%cerveja%', '%suco%', '%vinho%', '%dose%']);

-- Cada pedido sabe se precisa de preparo
alter table public.pedidos add column precisa_preparo boolean not null default true;

-- O tablet passa a separar o pedido: o que vai para a cozinha e o que já pode ser servido
create or replace function public.mesa_criar_pedido(p_token text, p_itens jsonb, p_obs text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_mesa public.mesas;
  v_rest public.restaurantes;
  v_item jsonb;
  v_prod public.produtos;
  v_qtd int;
  v_grupo boolean;
  v_linhas jsonb;
  v_total numeric(10,2);
  v_numero int;
  v_pedido uuid;
  v_cozinha jsonb := '[]'::jsonb;
  v_prontos jsonb := '[]'::jsonb;
  v_ids jsonb := '[]'::jsonb;
  v_numeros jsonb := '[]'::jsonb;
  v_soma numeric(10,2) := 0;
begin
  select * into v_mesa from public.mesas where token = p_token and ativo;
  if not found then raise exception 'Mesa não encontrada'; end if;
  select * into v_rest from public.restaurantes where id = v_mesa.restaurante_id;
  if not v_rest.ativo then raise exception 'Restaurante indisponível no momento'; end if;
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'O pedido está vazio';
  end if;
  if jsonb_array_length(p_itens) > 50 then raise exception 'Itens demais em um só pedido'; end if;

  -- Valida, baixa o estoque e separa os itens em dois grupos
  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_qtd := (v_item ->> 'qtd')::int;
    if v_qtd is null or v_qtd < 1 or v_qtd > 50 then raise exception 'Quantidade inválida'; end if;

    select * into v_prod from public.produtos
    where id = (v_item ->> 'produto_id')::uuid and restaurante_id = v_rest.id and ativo
    for update;
    if not found then raise exception 'Um dos itens não está mais disponível'; end if;

    if v_prod.controla_estoque then
      if v_prod.estoque < v_qtd then
        raise exception 'Estoque insuficiente de "%" (restam %)', v_prod.nome, v_prod.estoque;
      end if;
      update public.produtos set estoque = estoque - v_qtd where id = v_prod.id;
    end if;

    v_linhas := jsonb_build_object(
      'produto_id', v_prod.id, 'nome', v_prod.nome, 'preco', v_prod.preco, 'qtd', v_qtd,
      'obs', nullif(left(trim(v_item ->> 'obs'), 140), ''), 'controla', v_prod.controla_estoque
    );
    if v_prod.precisa_preparo then v_cozinha := v_cozinha || v_linhas;
    else v_prontos := v_prontos || v_linhas;
    end if;
  end loop;

  -- Um pedido por grupo: primeiro o da cozinha, depois o que já pode ser servido
  foreach v_grupo in array array[true, false] loop
    v_linhas := case when v_grupo then v_cozinha else v_prontos end;
    continue when jsonb_array_length(v_linhas) = 0;

    select coalesce(sum((l ->> 'preco')::numeric * (l ->> 'qtd')::int), 0) into v_total
    from jsonb_array_elements(v_linhas) l;

    update public.restaurantes set ultimo_pedido = ultimo_pedido + 1
    where id = v_rest.id returning ultimo_pedido into v_numero;

    insert into public.pedidos (restaurante_id, mesa_id, mesa_nome, numero, observacao, total, precisa_preparo)
    values (v_rest.id, v_mesa.id, v_mesa.nome, v_numero, nullif(left(trim(p_obs), 300), ''), v_total, v_grupo)
    returning id into v_pedido;

    insert into public.pedido_itens (pedido_id, restaurante_id, produto_id, nome, preco_unit, qtd, obs)
    select v_pedido, v_rest.id, (l ->> 'produto_id')::uuid, l ->> 'nome', (l ->> 'preco')::numeric, (l ->> 'qtd')::int, l ->> 'obs'
    from jsonb_array_elements(v_linhas) l;

    insert into public.movimentos_estoque (restaurante_id, produto_id, delta, motivo, pedido_id, user_id)
    select v_rest.id, (l ->> 'produto_id')::uuid, -((l ->> 'qtd')::int), 'Pedido #' || v_numero, v_pedido, null
    from jsonb_array_elements(v_linhas) l where (l ->> 'controla')::boolean;

    v_ids := v_ids || to_jsonb(v_pedido);
    v_numeros := v_numeros || to_jsonb(v_numero);
    v_soma := v_soma + v_total;
  end loop;

  return jsonb_build_object(
    'id', v_ids -> 0,
    'numero', (v_numeros -> 0)::int,
    'numeros', v_numeros,
    'ids', v_ids,
    'total', v_soma
  );
end $$;
