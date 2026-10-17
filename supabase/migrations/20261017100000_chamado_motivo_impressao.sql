-- 1) Chamado do garçom com motivo (sal e limão, talheres, limpar a mesa, outra coisa...)
alter table public.chamados add column motivo text check (char_length(motivo) <= 60);
alter table public.chamados add column detalhe text check (char_length(detalhe) <= 140);

drop function public.mesa_chamar(text, text);
create function public.mesa_chamar(p_token text, p_tipo text, p_motivo text default null, p_detalhe text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_mesa public.mesas;
  v_motivo text := nullif(left(trim(p_motivo), 60), '');
  v_detalhe text := nullif(left(trim(p_detalhe), 140), '');
begin
  if p_tipo not in ('garcom', 'conta') then raise exception 'Tipo inválido'; end if;
  select * into v_mesa from public.mesas where token = p_token and ativo;
  if not found then raise exception 'Mesa não encontrada'; end if;
  -- Evita repetir o mesmo pedido enquanto ninguém atendeu
  if exists (
    select 1 from public.chamados
    where mesa_id = v_mesa.id and tipo = p_tipo and atendido_em is null
      and coalesce(motivo, '') = coalesce(v_motivo, '') and coalesce(detalhe, '') = coalesce(v_detalhe, '')
  ) then
    return;
  end if;
  insert into public.chamados (restaurante_id, mesa_id, mesa_nome, tipo, motivo, detalhe)
  values (v_mesa.restaurante_id, v_mesa.id, v_mesa.nome, p_tipo, v_motivo, v_detalhe);
end $$;

revoke execute on function public.mesa_chamar(text, text, text, text) from public;
grant execute on function public.mesa_chamar(text, text, text, text) to anon, authenticated;

-- Notificação no celular já diz o motivo
create or replace function privado.notificar_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_segredo text;
  v_payload jsonb;
begin
  select valor into v_url from privado.config where chave = 'push_url';
  select valor into v_segredo from privado.config where chave = 'push_segredo';
  if v_url is null then return new; end if;

  if tg_table_name = 'pedidos' then
    if tg_op = 'INSERT' then
      v_payload := jsonb_build_object(
        'titulo', 'Novo pedido #' || new.numero || ' · ' || new.mesa_nome,
        'corpo', 'Total R$ ' || replace(to_char(new.total, 'FM999990.00'), '.', ','),
        'tag', 'pedido-' || new.id);
    elsif new.status = 'pronto' and old.status is distinct from 'pronto' then
      v_payload := jsonb_build_object(
        'titulo', 'Pedido #' || new.numero || ' pronto · ' || new.mesa_nome,
        'corpo', 'Pode levar para a mesa.',
        'tag', 'pedido-' || new.id);
    else
      return new;
    end if;
  elsif tg_table_name = 'chamados' then
    v_payload := jsonb_build_object(
      'titulo', case
        when new.tipo = 'conta' then new.mesa_nome || ' pediu a conta'
        when new.motivo is not null then new.mesa_nome || ': ' || new.motivo
        else new.mesa_nome || ' chamou o garçom' end,
      'corpo', coalesce(new.detalhe, 'Toque para ver e marcar como atendido.'),
      'tag', 'chamado-' || new.id);
  else
    return new;
  end if;

  v_payload := v_payload || jsonb_build_object('restaurante_id', new.restaurante_id, 'url', '/garcom');
  perform net.http_post(
    url := v_url,
    body := v_payload,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-segredo', v_segredo)
  );
  return new;
end $$;

-- 2) Fila de impressão: o garçom pede pelo celular, o computador do caixa imprime
create table public.fila_impressao (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  tipo text not null check (tipo in ('conta')),
  mesa_id uuid references public.mesas on delete cascade,
  solicitado_por uuid references auth.users on delete set null default auth.uid(),
  solicitado_por_nome text,
  criado_em timestamptz not null default now(),
  impresso_em timestamptz
);
create index on public.fila_impressao (restaurante_id, criado_em desc);
create index on public.fila_impressao (mesa_id);
create index on public.fila_impressao (solicitado_por);

alter table public.fila_impressao enable row level security;
revoke all on public.fila_impressao from anon;
revoke insert, update, delete on public.fila_impressao from authenticated;
create policy "ver fila de impressao" on public.fila_impressao for select to authenticated
  using (public.eh_membro(restaurante_id));

create function public.impressao_solicitar_conta(p_mesa uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rest uuid;
  v_id uuid;
begin
  select restaurante_id into v_rest from public.mesas where id = p_mesa;
  if v_rest is null or not public.eh_membro(v_rest) then raise exception 'Mesa não encontrada'; end if;
  insert into public.fila_impressao (restaurante_id, tipo, mesa_id, solicitado_por_nome)
  values (v_rest, 'conta', p_mesa, public.nome_membro(v_rest))
  returning id into v_id;
  return v_id;
end $$;

-- O computador que imprime "pega" o pedido; garante que só um imprime
create function public.impressao_reivindicar(p_id uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ok boolean;
begin
  update public.fila_impressao set impresso_em = now()
  where id = p_id and impresso_em is null and public.eh_membro(restaurante_id)
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

revoke execute on function public.impressao_solicitar_conta(uuid), public.impressao_reivindicar(uuid) from public, anon;
grant execute on function public.impressao_solicitar_conta(uuid), public.impressao_reivindicar(uuid) to authenticated;

alter publication supabase_realtime add table public.fila_impressao;

-- 3) Toque "sino de garçom" continua sendo o padrão (id campainha)
