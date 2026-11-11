-- Bot do WhatsApp do financeiro: o dono manda a foto do comprovante (ou escreve o que comprou)
-- e a despesa entra sozinha no financeiro. Um número de WhatsApp da plataforma atende todas as lojas;
-- cada loja cadastra os números de quem pode mandar.

create table if not exists public.fin_bot_numeros (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  telefone text not null unique check (telefone ~ '^\d{12,13}$'),
  nome text not null default '',
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create index if not exists fin_bot_num_rest_idx on public.fin_bot_numeros (restaurante_id);

create table if not exists public.fin_bot_mensagens (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid references public.restaurantes(id) on delete cascade,
  telefone text not null,
  wa_id text not null unique,
  tipo text not null,
  texto text,
  lancamento_id uuid references public.fin_lancamentos(id) on delete set null,
  resposta text,
  criado_em timestamptz not null default now()
);
create index if not exists fin_bot_msg_rest_idx on public.fin_bot_mensagens (restaurante_id, criado_em desc);
create index if not exists fin_bot_msg_tel_idx on public.fin_bot_mensagens (telefone, criado_em desc);
create index if not exists fin_bot_msg_lanc_idx on public.fin_bot_mensagens (lancamento_id) where lancamento_id is not null;

alter table public.fin_bot_numeros enable row level security;
alter table public.fin_bot_mensagens enable row level security;
drop policy if exists "gestao financeiro" on public.fin_bot_numeros;
create policy "gestao financeiro" on public.fin_bot_numeros for all to authenticated
  using (public.tem_papel(restaurante_id, '{dono,gerente}')) with check (public.tem_papel(restaurante_id, '{dono,gerente}'));
drop policy if exists "gestao ve mensagens" on public.fin_bot_mensagens;
create policy "gestao ve mensagens" on public.fin_bot_mensagens for select to authenticated
  using (public.tem_papel(restaurante_id, '{dono,gerente}'));
revoke all on public.fin_bot_numeros, public.fin_bot_mensagens from anon;
grant select, insert, update, delete on public.fin_bot_numeros to authenticated;
grant select on public.fin_bot_mensagens to authenticated;

-- Número do bot (da plataforma) para mostrar na tela; null enquanto não estiver configurado
create or replace function public.fin_bot_info()
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object('numero', (select valor from privado.config where chave = 'whatsapp_bot_numero'));
$$;
revoke execute on function public.fin_bot_info() from anon, public;
grant execute on function public.fin_bot_info() to authenticated;
