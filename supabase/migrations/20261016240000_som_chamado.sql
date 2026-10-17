-- Toque do "chamar garçom", escolhido pelo restaurante (vale para o painel e os celulares)
alter table public.restaurantes
  add column som_chamado text not null default 'campainha'
  check (som_chamado in ('campainha', 'sino', 'alerta', 'marimba'));

grant update (som_chamado) on public.restaurantes to authenticated;
