-- Desafios do garçom: registra quem lançou, quem entregou e quem atendeu (automático)

alter table public.pedidos add column if not exists criado_por uuid;
alter table public.pedidos add column if not exists entregue_por uuid;
alter table public.chamados add column if not exists atendido_por uuid;
create index if not exists pedidos_entregue_por on public.pedidos (restaurante_id, entregue_por, atualizado_em) where entregue_por is not null;
create index if not exists pedidos_criado_por on public.pedidos (restaurante_id, criado_por, criado_em) where criado_por is not null;

create or replace function privado.pedido_quem() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.eh_membro(new.restaurante_id) then return new; end if;
  if tg_op = 'INSERT' then
    new.criado_por := coalesce(new.criado_por, auth.uid());
  elsif new.status = 'entregue' and old.status is distinct from 'entregue' then
    new.entregue_por := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists pedido_quem on public.pedidos;
create trigger pedido_quem before insert or update of status on public.pedidos
  for each row execute function privado.pedido_quem();

create or replace function privado.chamado_quem() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.atendido_em is not null and old.atendido_em is null and auth.uid() is not null then
    new.atendido_por := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists chamado_quem on public.chamados;
create trigger chamado_quem before update of atendido_em on public.chamados
  for each row execute function privado.chamado_quem();

-- Números do garçom (hoje e semana) + ranking da semana da equipe
create or replace function public.garcom_desafios(p_rest uuid, p_tz text default 'America/Sao_Paulo') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_eu uuid := auth.uid();
  v_hoje timestamptz := date_trunc('day', now() at time zone p_tz) at time zone p_tz;
  v_semana timestamptz := date_trunc('week', now() at time zone p_tz) at time zone p_tz;
begin
  if not public.eh_membro(p_rest) then raise exception 'Sem permissão'; end if;
  return jsonb_build_object(
    'hoje', privado.garcom_numeros(p_rest, v_eu, v_hoje),
    'semana', privado.garcom_numeros(p_rest, v_eu, v_semana),
    'ranking', coalesce((
      select jsonb_agg(z order by (z ->> 'pontos')::int desc, z ->> 'nome')
      from (
        select jsonb_build_object('user_id', m.user_id, 'nome', coalesce(nullif(m.nome, ''), split_part(m.email, '@', 1)), 'foto', m.foto_url,
          'eu', m.user_id = v_eu, 'pontos', (n ->> 'pontos')::int) as z
        from public.membros m
        cross join lateral (select privado.garcom_numeros(p_rest, m.user_id, v_semana) as n) x
        where m.restaurante_id = p_rest and m.papel in ('garcom', 'gerente', 'caixa', 'dono')
          and ((n ->> 'pontos')::int > 0 or m.user_id = v_eu or m.papel = 'garcom')
      ) y
    ), '[]'::jsonb)
  );
end $$;

create or replace function privado.garcom_numeros(p_rest uuid, p_user uuid, p_desde timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  with n as (
    select
      (select count(*) from public.pedidos where restaurante_id = p_rest and entregue_por = p_user and atualizado_em >= p_desde) as entregues,
      (select count(*) from public.pedidos where restaurante_id = p_rest and criado_por = p_user and criado_em >= p_desde and status <> 'cancelado') as lancados,
      (select coalesce(sum(total), 0) from public.pedidos where restaurante_id = p_rest and criado_por = p_user and criado_em >= p_desde and status <> 'cancelado') as vendas,
      (select count(*) from public.chamados where restaurante_id = p_rest and atendido_por = p_user and atendido_em >= p_desde) as chamados,
      (select count(*) from public.mesa_acessos where restaurante_id = p_rest and respondido_por = p_user and status in ('liberado', 'encerrado') and respondido_em >= p_desde) as liberadas
  )
  select jsonb_build_object('entregues', entregues, 'lancados', lancados, 'vendas', vendas, 'chamados', chamados, 'liberadas', liberadas,
    'pontos', entregues * 2 + lancados * 2 + chamados + liberadas)
  from n
$$;

revoke all on function public.garcom_desafios(uuid, text) from public;
grant execute on function public.garcom_desafios(uuid, text) to authenticated;
revoke all on function privado.garcom_numeros(uuid, uuid, timestamptz) from public;
