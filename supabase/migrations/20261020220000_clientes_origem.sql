-- Meus clientes: delivery (pedidos e contas do cardápio), mesas (quem pede acesso) e balcão (PDV)

-- Contas do cardápio digital ligadas à loja em que o cliente entrou
create table if not exists public.clientes_lojas (
  user_id uuid not null references auth.users on delete cascade,
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  origem text not null check (origem in ('delivery', 'mesa')),
  primeiro_em timestamptz not null default now(),
  ultimo_em timestamptz not null default now(),
  primary key (user_id, restaurante_id, origem)
);
alter table public.clientes_lojas enable row level security;
revoke all on public.clientes_lojas from anon, authenticated;

-- O cliente logado avisa em qual loja entrou (cardápio digital)
create or replace function public.cliente_registrar_visita(p_codigo text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rest uuid;
begin
  if auth.uid() is null then return; end if;
  select id into v_rest from public.restaurantes where codigo = lower(trim(p_codigo));
  if v_rest is null then return; end if;
  insert into public.clientes_lojas (user_id, restaurante_id, origem) values (auth.uid(), v_rest, 'delivery')
  on conflict (user_id, restaurante_id, origem) do update set ultimo_em = now();
end $$;
revoke all on function public.cliente_registrar_visita(text) from public;
grant execute on function public.cliente_registrar_visita(text) to authenticated;

-- Quem já tinha conta: só existe uma loja até agora, e todos entraram pelo cardápio dela
insert into public.clientes_lojas (user_id, restaurante_id, origem, primeiro_em, ultimo_em)
select cp.user_id, r.id, 'delivery', cp.criado_em, cp.atualizado_em
from public.clientes_perfis cp cross join public.restaurantes r
where r.slug = 'cardapio'
on conflict do nothing;

-- Mesa: nome e WhatsApp (opcionais) de quem pede acesso
alter table public.mesa_acessos add column if not exists cliente_nome text check (char_length(cliente_nome) <= 60);
alter table public.mesa_acessos add column if not exists cliente_telefone text check (char_length(cliente_telefone) <= 13);

drop function if exists public.mesa_acesso_pedir(text, text, text);
create function public.mesa_acesso_pedir(p_token text, p_dispositivo text, p_aparelho text default null, p_nome text default null, p_telefone text default null) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_mesa public.mesas := privado.mesa_do_token(p_token);
  v_ultimo public.mesa_acessos;
  v_nome text := nullif(left(regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g'), 60), '');
  v_tel text := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
begin
  if privado.eh_equipe(v_mesa.restaurante_id) then return 'equipe'; end if;
  if char_length(coalesce(p_dispositivo, '')) not between 16 and 64 then raise exception 'Aparelho inválido'; end if;
  if v_tel is not null and char_length(v_tel) not between 10 and 13 then raise exception 'WhatsApp com DDD, ou deixe em branco'; end if;

  select * into v_ultimo from public.mesa_acessos
  where mesa_id = v_mesa.id and dispositivo = p_dispositivo
  order by (status = 'liberado') desc, criado_em desc limit 1;
  if v_ultimo.status in ('liberado', 'pendente') then return v_ultimo.status; end if;
  if v_ultimo.status = 'recusado' and v_ultimo.respondido_em > now() - interval '1 minute' then
    raise exception 'Aguarde um minutinho para pedir de novo';
  end if;
  if (select count(*) from public.mesa_acessos where mesa_id = v_mesa.id and status = 'pendente') >= 6 then
    raise exception 'Muitos pedidos de acesso nesta mesa. Chame um atendente.';
  end if;

  insert into public.mesa_acessos (restaurante_id, mesa_id, mesa_nome, dispositivo, aparelho, cliente_nome, cliente_telefone)
  values (v_mesa.restaurante_id, v_mesa.id, v_mesa.nome, p_dispositivo, nullif(left(trim(p_aparelho), 40), ''), v_nome, v_tel);
  return 'pendente';
end $$;
revoke all on function public.mesa_acesso_pedir(text, text, text, text, text) from public;
grant execute on function public.mesa_acesso_pedir(text, text, text, text, text) to anon, authenticated;

-- Lista de clientes com a origem de cada um
drop function if exists public.clientes_listar(uuid);
create function public.clientes_listar(p_rest uuid)
returns table (chave text, telefone text, nome text, email text, pedidos bigint, visitas_mesa bigint, total numeric,
  primeiro timestamptz, ultimo timestamptz, bairro text, fidelidade int, origens text[], conta boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.tem_papel(p_rest, '{dono,gerente,caixa}') then raise exception 'Sem permissão'; end if;
  return query
  with ped as (
    select coalesce(p.cliente_telefone, nullif(regexp_replace(coalesce(cp.telefone, ''), '\D', '', 'g'), ''), 'u:' || p.cliente_user_id::text) as k,
      p.cliente_telefone as tel, p.cliente_user_id as uid, p.cliente_nome as nm, p.total as tot, p.criado_em as em,
      p.endereco ->> 'bairro' as bai, p.status <> 'cancelado' as valido,
      case p.tipo when 'mesa' then 'mesa' when 'balcao' then 'balcao' else 'delivery' end as org
    from public.pedidos p
    left join public.clientes_perfis cp on cp.user_id = p.cliente_user_id
    where p.restaurante_id = p_rest and (p.cliente_telefone is not null or p.cliente_user_id is not null)
  ), contas as (
    select coalesce(nullif(regexp_replace(coalesce(cp.telefone, ''), '\D', '', 'g'), ''), 'u:' || cl.user_id::text) as k,
      cl.user_id as uid, cp.nome as nm, nullif(regexp_replace(coalesce(cp.telefone, ''), '\D', '', 'g'), '') as tel,
      cl.origem as org, cl.primeiro_em as ini, cl.ultimo_em as fim
    from public.clientes_lojas cl
    left join public.clientes_perfis cp on cp.user_id = cl.user_id
    where cl.restaurante_id = p_rest
  ), mesa as (
    select coalesce(a.cliente_telefone, 'm:' || lower(a.cliente_nome) || ':' || a.dispositivo) as k,
      a.cliente_telefone as tel, a.cliente_nome as nm, a.criado_em as em, a.status in ('liberado', 'encerrado') as valido
    from public.mesa_acessos a
    where a.restaurante_id = p_rest and (a.cliente_telefone is not null or a.cliente_nome is not null)
  ), chaves as (
    select ped.k from ped union select contas.k from contas union select mesa.k from mesa where mesa.valido
  )
  select c.k,
    coalesce((select ped.tel from ped where ped.k = c.k and ped.tel is not null order by ped.em desc limit 1),
             (select contas.tel from contas where contas.k = c.k and contas.tel is not null limit 1),
             (select mesa.tel from mesa where mesa.k = c.k and mesa.tel is not null limit 1)),
    coalesce((select ped.nm from ped where ped.k = c.k and ped.nm is not null order by ped.em desc limit 1),
             (select contas.nm from contas where contas.k = c.k and contas.nm is not null limit 1),
             (select mesa.nm from mesa where mesa.k = c.k and mesa.nm is not null order by mesa.em desc limit 1)),
    (select u.email::text from auth.users u where u.id = coalesce(
        (select contas.uid from contas where contas.k = c.k limit 1),
        (select ped.uid from ped where ped.k = c.k and ped.uid is not null limit 1))),
    (select count(*) from ped where ped.k = c.k and ped.valido),
    (select count(*) from mesa where mesa.k = c.k and mesa.valido),
    coalesce((select sum(ped.tot) from ped where ped.k = c.k and ped.valido), 0)::numeric,
    least((select min(ped.em) from ped where ped.k = c.k), (select min(contas.ini) from contas where contas.k = c.k), (select min(mesa.em) from mesa where mesa.k = c.k)),
    greatest((select max(ped.em) from ped where ped.k = c.k), (select max(contas.fim) from contas where contas.k = c.k), (select max(mesa.em) from mesa where mesa.k = c.k)),
    (select ped.bai from ped where ped.k = c.k and ped.bai is not null order by ped.em desc limit 1),
    case when c.k ~ '^\d+$' then privado.fidelidade_pontos(p_rest, c.k) else 0 end,
    array(select distinct z.o from (
      select ped.org as o from ped where ped.k = c.k
      union select contas.org from contas where contas.k = c.k
      union select 'mesa' from mesa where mesa.k = c.k and mesa.valido) z order by 1),
    exists (select 1 from contas where contas.k = c.k)
  from chaves c
  order by 9 desc nulls last;
end $$;
revoke all on function public.clientes_listar(uuid) from public;
grant execute on function public.clientes_listar(uuid) to authenticated;
