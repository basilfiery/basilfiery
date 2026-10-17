-- Liberação da mesa pelo garçom.
-- Quem abre o link/QR da mesa pode ver o cardápio, mas só faz pedido, chama o garçom
-- ou vê a conta depois que alguém da equipe liberar aquele aparelho.
-- Ao fechar a conta, os aparelhos liberados perdem o acesso (menos o "tablet fixo" da mesa).

create table public.mesa_acessos (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  mesa_id uuid not null references public.mesas on delete cascade,
  mesa_nome text not null,
  dispositivo text not null check (char_length(dispositivo) between 16 and 64),
  aparelho text check (char_length(aparelho) <= 40),
  status text not null default 'pendente' check (status in ('pendente', 'liberado', 'recusado', 'encerrado')),
  fixo boolean not null default false,
  criado_em timestamptz not null default now(),
  respondido_em timestamptz,
  respondido_por uuid references auth.users on delete set null,
  respondido_por_nome text
);
create index on public.mesa_acessos (mesa_id, dispositivo);
create index on public.mesa_acessos (restaurante_id) where status = 'pendente';

alter table public.mesa_acessos enable row level security;
create policy "equipe vê acessos" on public.mesa_acessos for select to authenticated using (public.eh_membro(restaurante_id));
revoke insert, update, delete on public.mesa_acessos from anon, authenticated;
alter publication supabase_realtime add table public.mesa_acessos;

-- Quem está usando é da equipe do restaurante? (garçom lançando pedido pelo próprio celular)
create function privado.eh_equipe(p_rest uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.membros where restaurante_id = p_rest and user_id = auth.uid()
  ) or exists (select 1 from public.plataforma_admins where user_id = auth.uid())
$$;

create function privado.mesa_do_token(p_token text) returns public.mesas
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.mesas;
begin
  select * into v from public.mesas where token = p_token and ativo;
  if not found then raise exception 'Mesa não encontrada'; end if;
  return v;
end $$;

create function privado.exigir_acesso(p_mesa public.mesas, p_dispositivo text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if privado.eh_equipe(p_mesa.restaurante_id) then return; end if;
  if not exists (
    select 1 from public.mesa_acessos
    where mesa_id = p_mesa.id and dispositivo = p_dispositivo and status = 'liberado'
  ) then
    raise exception 'MESA_FECHADA: Peça ao garçom para liberar a mesa';
  end if;
end $$;

-- Situação deste aparelho na mesa
create function public.mesa_acesso_status(p_token text, p_dispositivo text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mesa public.mesas := privado.mesa_do_token(p_token);
  v_status text;
begin
  if privado.eh_equipe(v_mesa.restaurante_id) then return 'equipe'; end if;
  select status into v_status from public.mesa_acessos
  where mesa_id = v_mesa.id and dispositivo = p_dispositivo
  order by (status = 'liberado') desc, criado_em desc limit 1;
  return case when v_status is null or v_status = 'encerrado' then 'nenhum' else v_status end;
end $$;

-- O cliente pede para abrir a mesa
create function public.mesa_acesso_pedir(p_token text, p_dispositivo text, p_aparelho text default null) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_mesa public.mesas := privado.mesa_do_token(p_token);
  v_ultimo public.mesa_acessos;
begin
  if privado.eh_equipe(v_mesa.restaurante_id) then return 'equipe'; end if;
  if char_length(coalesce(p_dispositivo, '')) not between 16 and 64 then raise exception 'Aparelho inválido'; end if;

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

  insert into public.mesa_acessos (restaurante_id, mesa_id, mesa_nome, dispositivo, aparelho)
  values (v_mesa.restaurante_id, v_mesa.id, v_mesa.nome, p_dispositivo, nullif(left(trim(p_aparelho), 40), ''));
  return 'pendente';
end $$;

-- A equipe libera ou recusa (fixo = tablet da mesa, continua liberado depois de fechar a conta)
create function public.mesa_acesso_responder(p_acesso uuid, p_liberar boolean, p_fixo boolean default false) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.mesa_acessos;
begin
  select * into v from public.mesa_acessos where id = p_acesso;
  if not found or not public.eh_membro(v.restaurante_id) then raise exception 'Pedido de acesso não encontrado'; end if;
  if v.status <> 'pendente' then return; end if; -- outra pessoa já respondeu
  update public.mesa_acessos set
    status = case when p_liberar then 'liberado' else 'recusado' end,
    fixo = p_liberar and coalesce(p_fixo, false),
    respondido_em = now(),
    respondido_por = auth.uid(),
    respondido_por_nome = public.nome_membro(v.restaurante_id)
  where id = p_acesso;
end $$;

-- Desconecta um aparelho (ex.: tablet trocado de mesa)
create function public.mesa_acesso_encerrar(p_acesso uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.mesa_acessos;
begin
  select * into v from public.mesa_acessos where id = p_acesso;
  if not found or not public.eh_membro(v.restaurante_id) then raise exception 'Aparelho não encontrado'; end if;
  update public.mesa_acessos set status = 'encerrado', respondido_em = now() where id = p_acesso;
end $$;

-- Pedido, chamado e conta agora exigem o aparelho liberado
create function public.mesa_pedido_enviar(p_token text, p_dispositivo text, p_itens jsonb, p_obs text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform privado.exigir_acesso(privado.mesa_do_token(p_token), p_dispositivo);
  return public.mesa_criar_pedido(p_token, p_itens, p_obs);
end $$;

create function public.mesa_chamado_enviar(p_token text, p_dispositivo text, p_tipo text, p_motivo text default null, p_detalhe text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform privado.exigir_acesso(privado.mesa_do_token(p_token), p_dispositivo);
  perform public.mesa_chamar(p_token, p_tipo, p_motivo, p_detalhe);
end $$;

create function public.mesa_conta_ver(p_token text, p_dispositivo text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform privado.exigir_acesso(privado.mesa_do_token(p_token), p_dispositivo);
  return public.mesa_conta(p_token);
end $$;

-- As funções antigas deixam de ser chamadas direto pelo navegador
revoke execute on function public.mesa_criar_pedido(text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.mesa_chamar(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.mesa_conta(text) from public, anon, authenticated;

revoke execute on function
  public.mesa_acesso_status(text, text), public.mesa_acesso_pedir(text, text, text),
  public.mesa_pedido_enviar(text, text, jsonb, text), public.mesa_chamado_enviar(text, text, text, text, text),
  public.mesa_conta_ver(text, text), public.mesa_acesso_responder(uuid, boolean, boolean), public.mesa_acesso_encerrar(uuid)
from public;
grant execute on function
  public.mesa_acesso_status(text, text), public.mesa_acesso_pedir(text, text, text),
  public.mesa_pedido_enviar(text, text, jsonb, text), public.mesa_chamado_enviar(text, text, text, text, text),
  public.mesa_conta_ver(text, text)
to anon, authenticated;
grant execute on function public.mesa_acesso_responder(uuid, boolean, boolean), public.mesa_acesso_encerrar(uuid) to authenticated;

-- Fechar a conta encerra o acesso dos aparelhos (menos o tablet fixo)
create or replace function public.mesa_fechar_conta(p_mesa uuid, p_forma text default 'outro') returns numeric
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_mesa public.mesas;
  v_caixa uuid;
  v_total numeric;
  v_pag uuid;
begin
  select * into v_mesa from public.mesas where id = p_mesa;
  if not found or not public.tem_papel(v_mesa.restaurante_id, '{dono,gerente,caixa}') then
    raise exception 'Sem permissão para fechar contas';
  end if;
  if p_forma not in ('dinheiro', 'pix', 'credito', 'debito', 'outro') then raise exception 'Forma de pagamento inválida'; end if;

  select id into v_caixa from public.caixas where restaurante_id = v_mesa.restaurante_id and fechado_em is null;
  if v_caixa is null then raise exception 'Abra o caixa antes de receber pagamentos'; end if;

  select coalesce(sum(total), 0) into v_total
  from public.pedidos where mesa_id = p_mesa and pago_em is null and status <> 'cancelado';

  if v_total > 0 then
    insert into public.pagamentos (restaurante_id, caixa_id, mesa_id, mesa_nome, forma, valor)
    values (v_mesa.restaurante_id, v_caixa, v_mesa.id, v_mesa.nome, p_forma, v_total)
    returning id into v_pag;
  end if;

  update public.pedidos set pago_em = now(), pagamento_id = case when status = 'cancelado' then null else v_pag end
  where mesa_id = p_mesa and pago_em is null;
  update public.chamados set atendido_em = now() where mesa_id = p_mesa and atendido_em is null;
  update public.mesa_acessos set status = 'encerrado', respondido_em = now()
  where mesa_id = p_mesa and status in ('liberado', 'pendente') and not fixo;
  return v_total;
end $$;

-- Trocar de mesa: o celular do cliente precisa ser liberado de novo na mesa nova
create or replace function public.mesa_trocar(p_origem uuid, p_destino uuid) returns int
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
  update public.mesa_acessos set status = 'encerrado', respondido_em = now()
  where mesa_id = p_origem and status in ('liberado', 'pendente') and not fixo;
  return v_qtd;
end $$;

-- Celular do garçom avisa quando uma mesa pede para abrir
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
  elsif tg_table_name = 'mesa_acessos' then
    v_payload := jsonb_build_object(
      'titulo', new.mesa_nome || ' quer fazer pedidos',
      'corpo', 'Toque para liberar a mesa' || coalesce(' (' || new.aparelho || ')', '') || '.',
      'tag', 'acesso-' || new.id);
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

create trigger notificar_acesso after insert on public.mesa_acessos
  for each row execute function privado.notificar_push();
