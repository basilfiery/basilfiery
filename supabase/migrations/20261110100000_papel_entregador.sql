-- Novo cargo: entregador (motoboy). Precisa ficar num passo separado: o Postgres só usa o valor novo depois de gravado.
alter type public.papel_membro add value if not exists 'entregador';
