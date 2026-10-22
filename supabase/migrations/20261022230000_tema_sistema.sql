-- Configurações › Aparência: cor do sistema (painel) — laranja (tradicional), vermelho ou verde
alter table public.restaurantes add column if not exists tema_sistema text check (tema_sistema in ('laranja', 'vermelho', 'verde'));
grant update (tema_sistema) on public.restaurantes to authenticated;
