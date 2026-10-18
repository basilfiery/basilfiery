-- =====================================================================
-- 1) Capa do cardápio em vídeo (além da imagem), em cima das categorias
-- 2) App dos colaboradores: o dono cria o acesso (usuário + senha) de cada um
-- =====================================================================

alter table public.restaurantes add column capa_video_url text check (char_length(capa_video_url) <= 500);
grant update (capa_video_url) on public.restaurantes to authenticated;

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
    'restaurante', jsonb_build_object('id', v_rest.id, 'nome', v_rest.nome, 'slogan', v_rest.slogan, 'logo_url', v_rest.logo_url, 'cor', v_rest.cor,
      'capa_url', v_rest.loja_capa_url, 'capa_video_url', v_rest.capa_video_url),
    'mesa', jsonb_build_object('id', v_mesa.id, 'nome', v_mesa.nome)
  ) || privado.cardapio_json(v_rest.id);
end $$;

create or replace function public.loja_cardapio(p_codigo text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.restaurantes;
begin
  select * into v from public.restaurantes where codigo = lower(trim(p_codigo));
  if not found or not v.ativo then raise exception 'Loja não encontrada'; end if;
  return jsonb_build_object(
    'restaurante', jsonb_build_object(
      'id', v.id, 'nome', v.nome, 'slogan', v.slogan, 'logo_url', v.logo_url, 'cor', v.cor,
      'aberto', privado.loja_aberta(v), 'ligado', v.delivery_ativo,
      'taxa', v.delivery_taxa, 'minimo', v.delivery_minimo, 'tempo', v.delivery_tempo,
      'entrega', v.entrega_ativa, 'retirada', v.retirada_ativa, 'whatsapp', v.whatsapp, 'endereco', v.endereco,
      'segmento', v.segmento, 'instagram', v.instagram, 'capa_url', v.loja_capa_url, 'capa_video_url', v.capa_video_url,
      'descricao', v.loja_descricao, 'rodape', v.loja_rodape, 'obs', v.loja_obs, 'formas', to_jsonb(v.formas_pagamento),
      'horarios', case when v.horarios_ativos then v.horarios end,
      'ads', jsonb_strip_nulls(jsonb_build_object('pixel', v.ads_pixel, 'ga4', v.ads_ga4, 'gads', v.ads_gads)),
      'entrega_modo', v.entrega_modo, 'lat', v.lat, 'lng', v.lng,
      'cidade', nullif(trim(concat_ws('/', v.endereco_info ->> 'cidade', v.endereco_info ->> 'uf')), ''),
      'raios', case when v.entrega_modo = 'raio' then v.entrega_raios end,
      'bairros', case when v.entrega_modo = 'bairro' then (select jsonb_agg(jsonb_build_object('nome', b ->> 'nome', 'taxa', (b ->> 'taxa')::numeric) order by b ->> 'nome') from jsonb_array_elements(v.entrega_bairros) b) end,
      'fidelidade', case when coalesce((v.fidelidade ->> 'ativo')::boolean, false) then jsonb_build_object(
        'meta', coalesce(nullif(v.fidelidade ->> 'meta', '')::int, 10),
        'premio', v.fidelidade ->> 'premio',
        'minimo', coalesce(nullif(v.fidelidade ->> 'minimo', '')::numeric, 0)) end
    )
  ) || privado.cardapio_json(v.id);
end $$;

-- ---------- Colaboradores ----------
alter table public.compras_pessoas
  add column telefone text check (telefone ~ '^[0-9]{10,13}$'),
  add column login text check (login ~ '^[a-z0-9._-]{3,30}$');
create unique index compras_pessoas_login on public.compras_pessoas (restaurante_id, login) where login is not null;
grant select (telefone, login) on public.compras_pessoas to authenticated;
grant update (nome, telefone) on public.compras_pessoas to authenticated;

alter table public.compras_itens add column pedido_tel text check (char_length(pedido_tel) <= 13);

-- O dono cria o colaborador (já liberado)
create function public.colaborador_criar(p_rest uuid, p_nome text, p_telefone text, p_setor text, p_login text, p_senha text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_login text := lower(trim(p_login));
  v_tel text := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
begin
  if not public.tem_papel(p_rest, '{dono,gerente}') then raise exception 'Sem permissão'; end if;
  if char_length(trim(p_nome)) < 2 then raise exception 'Digite o nome'; end if;
  if v_login !~ '^[a-z0-9._-]{3,30}$' then raise exception 'Usuário: de 3 a 30 letras ou números, sem espaço'; end if;
  if char_length(coalesce(p_senha, '')) < 4 then raise exception 'A senha precisa ter pelo menos 4 caracteres'; end if;
  if v_tel is not null and char_length(v_tel) not between 10 and 13 then raise exception 'WhatsApp com DDD'; end if;
  if exists (select 1 from public.compras_pessoas where restaurante_id = p_rest and login = v_login) then
    raise exception 'Já existe alguém com o usuário "%"', v_login;
  end if;
  if exists (select 1 from public.compras_pessoas where restaurante_id = p_rest and lower(trim(nome)) = lower(trim(p_nome))) then
    raise exception 'Já existe um colaborador com esse nome. Coloque o sobrenome.';
  end if;
  insert into public.compras_pessoas (restaurante_id, nome, setor, pin_hash, status, telefone, login)
  values (p_rest, left(regexp_replace(trim(p_nome), '\s+', ' ', 'g'), 60), coalesce(nullif(left(trim(p_setor), 30), ''), 'Outro'),
    extensions.crypt(p_senha, extensions.gen_salt('bf')), 'ativo', v_tel, v_login)
  returning id into v_id;
  return v_id;
end $$;

-- Nova senha (desconecta os aparelhos dele)
create function public.colaborador_senha(p_rest uuid, p_id uuid, p_senha text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.tem_papel(p_rest, '{dono,gerente}') then raise exception 'Sem permissão'; end if;
  if char_length(coalesce(p_senha, '')) < 4 then raise exception 'A senha precisa ter pelo menos 4 caracteres'; end if;
  update public.compras_pessoas set pin_hash = extensions.crypt(p_senha, extensions.gen_salt('bf')), token_hash = null, tentativas = 0, travado_ate = null
  where id = p_id and restaurante_id = p_rest;
end $$;

-- Entrar com o usuário (ou o nome, para quem se cadastrou antes) e a senha
create or replace function public.compras_entrar(p_codigo text, p_nome text, p_pin text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.compras_pessoas;
  v_token text := 'lc_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_quem text := lower(regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g'));
begin
  select p.* into v from public.compras_pessoas p join public.restaurantes r on r.id = p.restaurante_id
  where r.codigo = lower(trim(p_codigo)) and (p.login = v_quem or lower(trim(p.nome)) = v_quem)
  order by (p.login = v_quem) desc limit 1;
  if not found then raise exception 'Usuário ou senha incorretos'; end if;
  if v.travado_ate is not null and v.travado_ate > now() then raise exception 'Muitas tentativas. Espere 15 minutos.'; end if;
  if v.pin_hash <> extensions.crypt(coalesce(p_pin, ''), v.pin_hash) then
    update public.compras_pessoas set tentativas = tentativas + 1,
      travado_ate = case when tentativas + 1 >= 5 then now() + interval '15 minutes' end
    where id = v.id;
    raise exception 'Usuário ou senha incorretos';
  end if;
  if v.status = 'bloqueado' then raise exception 'Seu acesso foi desligado. Fale com o responsável.'; end if;
  update public.compras_pessoas set tentativas = 0, travado_ate = null, ultimo_acesso = now(),
    token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
  where id = v.id;
  return v_token;
end $$;

-- O cadastro agora é feito pelo dono
create or replace function public.compras_cadastrar(p_codigo text, p_nome text, p_setor text, p_pin text) returns text
language plpgsql volatile security definer set search_path = '' as $$
begin
  raise exception 'Peça seu usuário e senha ao responsável.';
end $$;

-- Pedido de compra leva o WhatsApp de quem pediu
create or replace function public.compras_pedir(p_token text, p_nome text, p_quantidade text, p_obs text, p_urgente boolean) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.compras_pessoas := privado.compras_pessoa(p_token);
  v_id uuid;
begin
  if v.status <> 'ativo' then raise exception 'Seu acesso ainda não foi liberado'; end if;
  if nullif(trim(p_nome), '') is null then raise exception 'Escreva o que precisa comprar'; end if;
  if (select count(*) from public.compras_itens where pessoa_id = v.id and status = 'pendente') >= 80 then
    raise exception 'Sua lista já está grande. Espere a próxima compra.';
  end if;
  insert into public.compras_itens (restaurante_id, nome, quantidade, obs, setor, urgente, pessoa_id, pedido_por, pedido_tel)
  values (v.restaurante_id, left(trim(p_nome), 80), nullif(left(trim(coalesce(p_quantidade, '')), 30), ''),
    nullif(left(trim(coalesce(p_obs, '')), 200), ''), v.setor, coalesce(p_urgente, false), v.id, v.nome, v.telefone)
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.colaborador_criar(uuid, text, text, text, text, text), public.colaborador_senha(uuid, uuid, text) from public, anon;
grant execute on function public.colaborador_criar(uuid, text, text, text, text, text), public.colaborador_senha(uuid, uuid, text) to authenticated;
