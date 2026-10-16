-- Capa do produto no cardápio do tablet: foto ou vídeo (rodando sozinho)
alter table public.produtos add column capa text not null default 'imagem' check (capa in ('imagem', 'video'));
grant update (capa) on public.produtos to authenticated;

-- Quem já tem vídeo e nenhuma foto passa a usar o vídeo como capa
update public.produtos set capa = 'video' where video_url is not null and imagem_url is null;

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
      select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'emoji', c.emoji) order by c.ordem, c.nome)
      from public.categorias c where c.restaurante_id = v_rest.id and c.ativo
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
      where p.restaurante_id = v_rest.id and p.ativo
    ), '[]'::jsonb)
  );
end $$;
