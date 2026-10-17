-- 1) Subcategorias: uma categoria pode ficar dentro de outra (um nível só).
--    Ex.: Comida > Pratos, Comida > Porções.
alter table public.categorias add column pai_id uuid references public.categorias on delete set null;
create index on public.categorias (pai_id);

create or replace function privado.validar_categoria_pai() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.pai_id is null then return new; end if;
  if new.pai_id = new.id then raise exception 'A categoria não pode ficar dentro dela mesma'; end if;
  if not exists (select 1 from public.categorias p
                 where p.id = new.pai_id and p.restaurante_id = new.restaurante_id and p.pai_id is null) then
    raise exception 'Escolha uma categoria principal para colocar esta dentro';
  end if;
  if exists (select 1 from public.categorias f where f.pai_id = new.id) then
    raise exception 'Esta categoria já tem subcategorias, então não pode ficar dentro de outra';
  end if;
  return new;
end $$;
create trigger validar_categoria_pai before insert or update of pai_id on public.categorias
  for each row execute function privado.validar_categoria_pai();

-- Cardápio do tablet agora informa a categoria "mãe"; subcategoria só aparece se a mãe estiver ativa
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
      select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'emoji', c.emoji, 'pai_id', c.pai_id) order by c.ordem, c.nome)
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
        'disponivel', (not p.controla_estoque) or p.estoque > 0,
        'estoque_max', case when p.controla_estoque then p.estoque end
      ) order by p.ordem, p.nome)
      from public.produtos p
      join public.categorias c on c.id = p.categoria_id and c.ativo
      left join public.categorias pai on pai.id = c.pai_id
      where p.restaurante_id = v_rest.id and p.ativo and (c.pai_id is null or pai.ativo)
    ), '[]'::jsonb)
  );
end $$;

-- 2) Trocar de mesa: leva a conta aberta (pedidos não pagos e chamados) para outra mesa.
--    Se a mesa de destino já tiver conta aberta, as contas são juntadas.
create function public.mesa_trocar(p_origem uuid, p_destino uuid) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_origem public.mesas;
  v_destino public.mesas;
  v_qtd int;
begin
  select * into v_origem from public.mesas where id = p_origem;
  select * into v_destino from public.mesas where id = p_destino;
  if v_origem.id is null or v_destino.id is null then raise exception 'Mesa não encontrada'; end if;
  if v_origem.restaurante_id <> v_destino.restaurante_id then raise exception 'As mesas são de restaurantes diferentes'; end if;
  if not public.tem_papel(v_origem.restaurante_id, '{dono,gerente,caixa,garcom}') then
    raise exception 'Sem permissão para trocar mesas';
  end if;
  if p_origem = p_destino then raise exception 'Escolha uma mesa diferente'; end if;

  update public.pedidos set mesa_id = v_destino.id, mesa_nome = v_destino.nome, atualizado_em = now()
  where mesa_id = p_origem and pago_em is null;
  get diagnostics v_qtd = row_count;
  if v_qtd = 0 then raise exception 'A % não tem conta aberta para trocar', v_origem.nome; end if;

  update public.chamados set mesa_id = v_destino.id, mesa_nome = v_destino.nome
  where mesa_id = p_origem and atendido_em is null;
  return v_qtd;
end $$;
revoke execute on function public.mesa_trocar(uuid, uuid) from public, anon;
grant execute on function public.mesa_trocar(uuid, uuid) to authenticated;
