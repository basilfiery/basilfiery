-- 1) Grupos de sabores: cadastra os sabores uma vez e liga em vários tamanhos.
--    Ex.: grupo "Sabores de pizza" ligado às subcategorias Pizza P (R$ 50), Pizza M (R$ 85), Pizza G (R$ 95).
--    No tablet, cada tamanho mostra os sabores do grupo com o preço do tamanho (+ acréscimo do sabor, se houver).
-- 2) Esgotar: o item continua no cardápio, marcado como "Esgotado", e não pode ser pedido.

create table public.grupos (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  nome text not null check (char_length(trim(nome)) between 1 and 60),
  ordem int not null default 0,
  criado_em timestamptz not null default now()
);
create index on public.grupos (restaurante_id);
alter table public.grupos enable row level security;
create policy "ver grupos" on public.grupos for select to authenticated using (public.eh_membro(restaurante_id));
create policy "gestor cria grupos" on public.grupos for insert to authenticated with check (public.tem_papel(restaurante_id, '{dono,gerente}'));
create policy "gestor edita grupos" on public.grupos for update to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente}')) with check (public.tem_papel(restaurante_id, '{dono,gerente}'));
create policy "gestor apaga grupos" on public.grupos for delete to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente}'));

-- Sabor = produto que pertence a um grupo (e não a uma categoria). O preço dele é o acréscimo.
alter table public.produtos add column grupo_id uuid references public.grupos on delete cascade;
alter table public.produtos add column esgotado boolean not null default false;
alter table public.produtos add constraint produto_categoria_ou_grupo check (categoria_id is null or grupo_id is null);
create index on public.produtos (grupo_id);
grant update (grupo_id, esgotado) on public.produtos to authenticated;

-- Tamanho ligado a um grupo: preço do tamanho
alter table public.categorias add column grupo_id uuid references public.grupos on delete set null;
alter table public.categorias add column preco_grupo numeric(10,2) check (preco_grupo >= 0);

-- Esgotar/voltar: gerente e caixa também (é o que acontece no meio do movimento)
create function public.produto_esgotar(p_produto uuid, p_esgotado boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rest uuid;
begin
  select restaurante_id into v_rest from public.produtos where id = p_produto;
  if v_rest is null or not public.tem_papel(v_rest, '{dono,gerente,caixa}') then
    raise exception 'Sem permissão para esgotar itens';
  end if;
  update public.produtos set esgotado = p_esgotado where id = p_produto;
end $$;
revoke execute on function public.produto_esgotar(uuid, boolean) from public, anon;
grant execute on function public.produto_esgotar(uuid, boolean) to authenticated;

-- Cardápio do tablet: tamanhos com grupo + lista de sabores
create or replace function public.mesa_cardapio(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mesa public.mesas;
  v_rest public.restaurantes;
begin
  select * into v_mesa from public.mesas where token = p_token and ativo;
  if not found then raise exception 'Mesa não encontrada'; end if;
  select * into v_rest from public.restaurantes where id = v_mesa.restaurante_id;
  if not v_rest.ativo then raise exception 'Restaurante indisponível no momento'; end if;

  return jsonb_build_object(
    'restaurante', jsonb_build_object('id', v_rest.id, 'nome', v_rest.nome, 'slogan', v_rest.slogan, 'logo_url', v_rest.logo_url, 'cor', v_rest.cor),
    'mesa', jsonb_build_object('id', v_mesa.id, 'nome', v_mesa.nome),
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'nome', c.nome, 'emoji', c.emoji, 'pai_id', c.pai_id,
        'grupo_id', c.grupo_id, 'preco_grupo', coalesce(c.preco_grupo, 0)
      ) order by c.ordem, c.nome)
      from public.categorias c
      left join public.categorias pai on pai.id = c.pai_id
      where c.restaurante_id = v_rest.id and c.ativo and (c.pai_id is null or pai.ativo)
    ), '[]'::jsonb),
    'produtos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'categoria_id', p.categoria_id, 'nome', p.nome, 'descricao', p.descricao,
        'preco', p.preco, 'emoji', p.emoji, 'imagem_url', p.imagem_url, 'video_url', p.video_url,
        'capa', case when p.capa = 'video' and p.video_url is not null then 'video' else 'imagem' end,
        'vegetariano', p.vegetariano, 'picancia', p.picancia, 'destaque', p.destaque, 'novo', p.novo,
        'disponivel', not p.esgotado and ((not p.controla_estoque) or p.estoque > 0),
        'estoque_max', case when p.controla_estoque then p.estoque end
      ) order by p.ordem, p.nome)
      from public.produtos p
      join public.categorias c on c.id = p.categoria_id and c.ativo
      left join public.categorias pai on pai.id = c.pai_id
      where p.restaurante_id = v_rest.id and p.ativo and (c.pai_id is null or pai.ativo)
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
      where p.restaurante_id = v_rest.id and p.ativo and p.grupo_id is not null
    ), '[]'::jsonb)
  );
end $$;

-- Pedido: sabor de grupo precisa vir com o tamanho (categoria); o preço é calculado aqui, nunca no aparelho
create or replace function public.mesa_criar_pedido(p_token text, p_itens jsonb, p_obs text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_mesa public.mesas;
  v_rest public.restaurantes;
  v_item jsonb;
  v_prod public.produtos;
  v_cat public.categorias;
  v_qtd int;
  v_nome text;
  v_preco numeric(10,2);
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

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_qtd := (v_item ->> 'qtd')::int;
    if v_qtd is null or v_qtd < 1 or v_qtd > 50 then raise exception 'Quantidade inválida'; end if;

    select * into v_prod from public.produtos
    where id = (v_item ->> 'produto_id')::uuid and restaurante_id = v_rest.id and ativo
    for update;
    if not found then raise exception 'Um dos itens não está mais disponível'; end if;
    if v_prod.esgotado then raise exception '"%" esgotou. Escolha outra opção.', v_prod.nome; end if;

    v_nome := v_prod.nome;
    v_preco := v_prod.preco;
    if v_prod.grupo_id is not null then
      -- Sabor: só vale dentro de um tamanho ligado ao grupo dele
      select * into v_cat from public.categorias
      where id = nullif(v_item ->> 'categoria_id', '')::uuid and restaurante_id = v_rest.id
        and ativo and grupo_id = v_prod.grupo_id;
      if not found then raise exception 'Escolha o tamanho de "%"', v_prod.nome; end if;
      v_nome := v_cat.nome || ' · ' || v_prod.nome;
      v_preco := coalesce(v_cat.preco_grupo, 0) + v_prod.preco;
    end if;

    if v_prod.controla_estoque then
      if v_prod.estoque < v_qtd then
        raise exception 'Estoque insuficiente de "%" (restam %)', v_prod.nome, v_prod.estoque;
      end if;
      update public.produtos set estoque = estoque - v_qtd where id = v_prod.id;
    end if;

    v_linhas := jsonb_build_object(
      'produto_id', v_prod.id, 'nome', v_nome, 'preco', v_preco, 'qtd', v_qtd,
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
-- Continua sem acesso direto pelo navegador (só via mesa_pedido_enviar)
revoke execute on function public.mesa_criar_pedido(text, jsonb, text) from public, anon, authenticated;
