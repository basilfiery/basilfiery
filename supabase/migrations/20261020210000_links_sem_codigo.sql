-- Links sem código: basilfiery.com.br/colaboradores e /appgarcom
-- O usuário do colaborador passa a ser único no sistema todo (o login acha a loja sozinho).

drop index if exists public.compras_pessoas_login;
create unique index if not exists compras_pessoas_login_unico on public.compras_pessoas (login) where login is not null;

create or replace function public.colaborador_criar(p_rest uuid, p_nome text, p_telefone text, p_setor text, p_login text, p_senha text) returns uuid
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
  if exists (select 1 from public.compras_pessoas where login = v_login) then
    raise exception 'O usuário "%" já existe. Escolha outro (ex.: %.%)', v_login, v_login,
      (select left(regexp_replace(lower(r.nome), '[^a-z0-9]', '', 'g'), 12) from public.restaurantes r where r.id = p_rest);
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

-- Entrar sem o código da loja: usuário + senha
create or replace function public.compras_entrar_usuario(p_usuario text, p_pin text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.compras_pessoas;
  v_codigo text;
  v_token text := 'lc_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_quem text := lower(trim(coalesce(p_usuario, '')));
begin
  select * into v from public.compras_pessoas where login = v_quem;
  if not found then raise exception 'Usuário ou senha incorretos'; end if;
  if v.travado_ate is not null and v.travado_ate > now() then raise exception 'Muitas tentativas. Espere 15 minutos.'; end if;
  if v.pin_hash <> extensions.crypt(coalesce(p_pin, ''), v.pin_hash) then
    update public.compras_pessoas set tentativas = tentativas + 1,
      travado_ate = case when tentativas + 1 >= 5 then now() + interval '15 minutes' end
    where id = v.id;
    raise exception 'Usuário ou senha incorretos';
  end if;
  if v.status = 'bloqueado' then raise exception 'Seu acesso foi desligado. Fale com o responsável.'; end if;
  select codigo into v_codigo from public.restaurantes where id = v.restaurante_id;
  update public.compras_pessoas set tentativas = 0, travado_ate = null, ultimo_acesso = now(),
    token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
  where id = v.id;
  return jsonb_build_object('token', v_token, 'codigo', v_codigo);
end $$;
revoke all on function public.compras_entrar_usuario(text, text) from public;
grant execute on function public.compras_entrar_usuario(text, text) to anon, authenticated;

-- "appgarcom" e "colaboradores" não podem virar endereço de loja
create or replace function public.slug_reservado(p text)
returns boolean language sql immutable set search_path = public as $$
  select p ~ '^mesa[0-9]*$' or p = any (array[
    'loja','login','entrar','cadastro','ativar','assinar','assinante','assinantes','assinatura','baixar','download','termos','privacidade','dono','g','garcom','garcons','appgarcom','lista','colaboradores',
    'plataforma','painel','admin','app','apps','api','assets','delivery','pedido','pedidos','suporte','ajuda',
    'contato','planos','precos','blog','www','site','basil','sw','manifest','versao','static','public','conta','perfil','dominios'
  ])
$$;
