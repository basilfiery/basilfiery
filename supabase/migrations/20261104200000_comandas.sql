-- Comandas: mesma coisa que uma mesa (QR, pedidos, conta), mas separadas na tela.
-- Útil quando duas pessoas da mesma mesa querem contas separadas.
alter table public.mesas add column tipo text not null default 'mesa' check (tipo in ('mesa', 'comanda'));
grant insert (tipo), update (tipo) on public.mesas to authenticated;

-- Quem já tinha criado "Comanda 1, 2, 3…" como mesa (ou no setor "Comandas") passa a ser comanda
update public.mesas set tipo = 'comanda', setor = case when setor ilike 'comanda%' then null else setor end
where nome ~* '^\s*comanda' or setor ilike 'comanda%';
