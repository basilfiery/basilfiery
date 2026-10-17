import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, Banknote, CheckCircle2, Lock, Printer, RefreshCw, Wallet } from 'lucide-react';
import { Campo, Switch } from '../../componentes/Basicos';
import { Modal } from '../../componentes/Modal';
import { useToast } from '../../componentes/Toast';
import { imprimirFechamento, imprimirMovimentoCaixa } from '../../lib/impressao';
import { msgErro, supabase } from '../../lib/supabase';
import type { Caixa, MovimentoCaixa, Papel, ResumoCaixa } from '../../lib/tipos';
import { FORMAS, brl, cx, dataHora, hora, lerPreco, podeCaixa } from '../../lib/util';
import { aplicarAtualizacao } from '../../lib/versao';import { IconeForma } from '../../componentes/Pagamento';


export type ModoCaixa = 'resumo' | 'fechar' | 'retirada';

interface Props {
  restaurante: { id: string; nome: string };
  papel: Papel;
  caixa: ResumoCaixa | null;
  modo: ModoCaixa;
  aoFechar: () => void;
  aoMudar: () => void;
  atualizarAoConcluir: boolean;
}

export function ModalCaixa({ restaurante, papel, caixa, modo: modoInicial, aoFechar, aoMudar, atualizarAoConcluir }: Props) {
  const [resultado, setResultado] = useState<ResumoCaixa | null>(null);
  const [modo, setModo] = useState<ModoCaixa>(modoInicial);
  const pode = podeCaixa(papel);

  const titulo = resultado ? 'Caixa fechado'
    : !caixa ? 'Abrir caixa'
      : modo === 'retirada' ? 'Retirada de caixa'
        : modo === 'fechar' ? 'Fechar caixa' : 'Resumo do caixa';

  function concluir() {
    if (atualizarAoConcluir) aplicarAtualizacao();
    else aoFechar();
  }

  return (
    <Modal aberto aoFechar={resultado ? concluir : aoFechar} titulo={titulo} largura={600}>
      {resultado ? (
        <Resultado r={resultado} restaurante={restaurante.nome} aoConcluir={concluir} atualizar={atualizarAoConcluir} />
      ) : !caixa ? (
        <CaixaFechado restaurante={restaurante} pode={pode} aoAberto={() => { aoMudar(); aoFechar(); }} />
      ) : modo === 'retirada' ? (
        <Retirada r={caixa} restaurante={restaurante.nome} pode={pode} aoVoltar={() => setModo('resumo')} aoConcluir={() => { aoMudar(); aoFechar(); }} />
      ) : (
        <CaixaAberto
          r={caixa}
          restaurante={restaurante}
          pode={pode}
          comFechamento={modo === 'fechar'}
          aoIrPara={setModo}
          aoFechado={(r) => { setResultado(r); aoMudar(); }}
        />
      )}
    </Modal>
  );
}

/* ---------------- Caixa fechado: abrir + histórico ---------------- */
function CaixaFechado({ restaurante, pode, aoAberto }: { restaurante: { id: string; nome: string }; pode: boolean; aoAberto: () => void }) {
  const toast = useToast();
  const [valor, setValor] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [historico, setHistorico] = useState<Caixa[]>([]);

  useEffect(() => {
    void supabase.from('caixas').select('*').eq('restaurante_id', restaurante.id)
      .not('fechado_em', 'is', null).order('aberto_em', { ascending: false }).limit(10)
      .then(({ data }) => setHistorico((data ?? []) as Caixa[]));
  }, [restaurante.id]);

  async function abrir() {
    const v = valor.trim() ? lerPreco(valor) : 0;
    if (!Number.isFinite(v) || v < 0) return toast('Valor de troco inválido. Ex.: 150,00', 'erro');
    setOcupado(true);
    const { error } = await supabase.rpc('caixa_abrir', { p_rest: restaurante.id, p_valor_inicial: v });
    setOcupado(false);
    if (error) return toast(msgErro(error), 'erro');
    toast('Caixa aberto. Boas vendas!', 'ok');
    aoAberto();
  }

  return (
    <div className="caixa">
      <div className="caixa__estado caixa__estado--fechado">
        <Wallet size={28} />
        <div>
          <strong>O caixa está fechado</strong>
          <span>Abra o caixa para receber pagamentos e fechar contas das mesas.</span>
        </div>
      </div>

      {pode ? (
        <div className="form">
          <Campo rotulo="Troco inicial na gaveta (R$)" dica="O dinheiro que já está no caixa ao começar. Pode deixar em branco se for zero.">
            <input className="input" inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} autoFocus
              onKeyDown={(e) => e.key === 'Enter' && void abrir()} />
          </Campo>
          <button className="btn btn--sucesso btn--lg" onClick={() => void abrir()} disabled={ocupado}>
            {ocupado ? 'Abrindo…' : 'Abrir caixa'}
          </button>
        </div>
      ) : (
        <p className="muted">Só dono, gerente ou caixa podem abrir o caixa.</p>
      )}

      {historico.length > 0 && (
        <section className="bloco">
          <h3>Últimos fechamentos</h3>
          <ul className="caixa__historico">
            {historico.map((c) => {
              const dif = c.resumo?.diferenca;
              return (
                <li key={c.id}>
                  <div>
                    <strong>{dataHora(c.aberto_em)} → {c.fechado_em ? hora(c.fechado_em) : ''}</strong>
                    <small className="muted">{c.fechado_por_nome ?? c.aberto_por_nome ?? ''}</small>
                  </div>
                  <span>{brl(Number(c.resumo?.recebido ?? 0))}</span>
                  {dif !== null && dif !== undefined && Number(dif) !== 0 && (
                    <span className={cx('badge', Number(dif) > 0 ? 'badge--azul' : 'badge--vermelho')}>
                      {Number(dif) > 0 ? 'sobra' : 'falta'} {brl(Math.abs(Number(dif)))}
                    </span>
                  )}
                  {c.resumo && (
                    <button className="icone-btn" title="Imprimir" aria-label="Imprimir fechamento" onClick={() => imprimirFechamento(c.resumo!, restaurante.nome, false)}>
                      <Printer size={18} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ---------------- Caixa aberto: resumo e fechamento ---------------- */
function CaixaAberto({ r, restaurante, pode, comFechamento, aoIrPara, aoFechado }: {
  r: ResumoCaixa;
  restaurante: { id: string; nome: string };
  pode: boolean;
  comFechamento: boolean;
  aoIrPara: (m: ModoCaixa) => void;
  aoFechado: (r: ResumoCaixa) => void;
}) {
  const toast = useToast();
  const [contado, setContado] = useState('');
  const [obs, setObs] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const valorContado = contado.trim() ? lerPreco(contado) : null;
  const diferenca = valorContado !== null && Number.isFinite(valorContado) ? valorContado - Number(r.dinheiro_esperado) : null;

  async function fechar() {
    if (valorContado !== null && !Number.isFinite(valorContado)) return toast('Valor contado inválido. Ex.: 350,00', 'erro');
    const avisoAberto = r.em_aberto.total > 0
      ? `\n\nAtenção: ainda há ${brl(r.em_aberto.total)} em aberto em ${r.em_aberto.mesas} mesa(s). Essas contas poderão ser fechadas no próximo caixa.`
      : '';
    if (!confirm(`Fechar o caixa agora?${avisoAberto}`)) return;
    setOcupado(true);
    const { data, error } = await supabase.rpc('caixa_fechar', { p_caixa: r.caixa_id, p_valor_contado: valorContado, p_obs: obs });
    setOcupado(false);
    if (error) return toast(msgErro(error), 'erro');
    aoFechado(data as ResumoCaixa);
  }

  return (
    <div className="caixa">
      <div className="caixa__estado caixa__estado--aberto">
        <Wallet size={28} />
        <div>
          <strong>Aberto às {hora(r.aberto_em)}{r.aberto_por_nome ? ` por ${r.aberto_por_nome}` : ''}</strong>
          <span>{new Date(r.aberto_em).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })} · troco inicial {brl(r.valor_inicial)}</span>
        </div>
      </div>

      <ResumoView r={r} />

      {r.em_aberto.total > 0 && (
        <p className="caixa__alerta"><AlertTriangle size={16} /> {brl(r.em_aberto.total)} ainda em aberto em {r.em_aberto.mesas} mesa(s).</p>
      )}

      {!pode ? (
        <p className="muted">Só dono, gerente ou caixa podem fazer retiradas e fechar o caixa.</p>
      ) : comFechamento ? (
        <section className="bloco">
          <h3>Fechamento</h3>
          <div className="form">
            <div className="form-linha">
              <Campo rotulo="Dinheiro contado na gaveta (R$)" dica={`Esperado: ${brl(r.dinheiro_esperado)}`}>
                <input className="input" inputMode="decimal" placeholder="0,00" value={contado} onChange={(e) => setContado(e.target.value)} autoFocus />
              </Campo>
              <div className={cx('caixa__diferenca', diferenca !== null && (Math.abs(diferenca) < 0.005 ? 'ok' : diferenca > 0 ? 'sobra' : 'falta'))}>
                <span>Diferença</span>
                <strong>
                  {diferenca === null ? '—' : Math.abs(diferenca) < 0.005 ? 'Confere' : `${diferenca > 0 ? 'Sobra' : 'Falta'} ${brl(Math.abs(diferenca))}`}
                </strong>
              </div>
            </div>
            <Campo rotulo="Observação (opcional)">
              <input className="input" value={obs} onChange={(e) => setObs(e.target.value)} maxLength={200} placeholder="Algo a registrar sobre este caixa" />
            </Campo>
            <div className="acoes-linha">
              <button className="btn btn--contorno" onClick={() => imprimirFechamento(r, restaurante.nome, true)}><Printer size={18} /> Imprimir parcial</button>
              <button className="btn btn--primario" style={{ flex: 1 }} onClick={() => void fechar()} disabled={ocupado}>
                {ocupado ? 'Fechando…' : 'Fechar caixa'}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <div className="acoes-linha">
          <button className="btn btn--contorno" onClick={() => imprimirFechamento(r, restaurante.nome, true)}><Printer size={18} /> Imprimir parcial</button>
          <button className="btn btn--contorno" onClick={() => aoIrPara('retirada')}><Banknote size={18} /> Retirada</button>
          <button className="btn btn--primario" style={{ flex: 1 }} onClick={() => aoIrPara('fechar')}><Lock size={18} /> Fechar caixa</button>
        </div>
      )}
    </div>
  );
}

/* ---------------- Retirada (sangria) ---------------- */
function Retirada({ r, restaurante, pode, aoVoltar, aoConcluir }: {
  r: ResumoCaixa;
  restaurante: string;
  pode: boolean;
  aoVoltar: () => void;
  aoConcluir: () => void;
}) {
  const toast = useToast();
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [imprimir, setImprimir] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const v = valor.trim() ? lerPreco(valor) : NaN;
  const disponivel = Number(r.dinheiro_esperado);
  const invalido = !Number.isFinite(v) || v <= 0;
  const excede = !invalido && v > disponivel + 0.001;

  async function registrar() {
    if (invalido || excede) return;
    setOcupado(true);
    const { data, error } = await supabase.rpc('caixa_movimentar', { p_caixa: r.caixa_id, p_tipo: 'retirada', p_valor: v, p_motivo: motivo });
    setOcupado(false);
    if (error) return toast(msgErro(error), 'erro');
    const novo = data as ResumoCaixa;
    const mov = novo.movimentos?.[novo.movimentos.length - 1];
    if (imprimir && mov) imprimirMovimentoCaixa(mov, restaurante, Number(novo.dinheiro_esperado));
    toast(`Retirada de ${brl(v)} registrada. Na gaveta: ${brl(Number(novo.dinheiro_esperado))}.`, 'ok');
    aoConcluir();
  }

  if (!pode) return <p className="muted">Só dono, gerente ou caixa podem fazer retiradas.</p>;

  return (
    <div className="caixa">
      <div className="caixa__estado caixa__estado--retirada">
        <Banknote size={28} />
        <div>
          <strong>Dinheiro esperado na gaveta: {brl(disponivel)}</strong>
          <span>A retirada é descontada do dinheiro esperado e entra no fechamento do caixa.</span>
        </div>
      </div>

      <div className="form">
        <Campo rotulo="Valor da retirada (R$)">
          <input className="input input--grande" inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} autoFocus
            onKeyDown={(e) => e.key === 'Enter' && void registrar()} />
        </Campo>
        {excede && <p className="erro-form">O valor é maior que o dinheiro esperado na gaveta ({brl(disponivel)}).</p>}
        <Campo rotulo="Motivo (opcional)">
          <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={120} placeholder="Ex.: depósito no banco, pagamento de fornecedor" />
        </Campo>
        <Switch marcado={imprimir} aoMudar={setImprimir}>Imprimir comprovante com espaço para assinatura</Switch>
        <div className="acoes-linha">
          <button className="btn btn--contorno" onClick={aoVoltar}>Voltar ao resumo</button>
          <button className="btn btn--primario" style={{ flex: 1 }} onClick={() => void registrar()} disabled={ocupado || invalido || excede}>
            {ocupado ? 'Registrando…' : invalido ? 'Registrar retirada' : `Registrar retirada de ${brl(v)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Peças do resumo ---------------- */
function ResumoView({ r }: { r: ResumoCaixa }) {
  const formas = FORMAS.filter((f) => r.por_forma[f.id]);
  const movimentos = r.movimentos ?? [];
  return (
    <>
      <div className="caixa__kpis">
        <div><span>Recebido</span><strong>{brl(r.recebido)}</strong><small>{r.contas_fechadas} conta(s)</small></div>
        <div><span>Vendas</span><strong>{brl(r.vendas.total)}</strong><small>{r.vendas.pedidos} pedido(s)</small></div>
        <div>
          <span>Dinheiro na gaveta</span>
          <strong>{brl(r.dinheiro_esperado)}</strong>
          <small>{Number(r.retiradas ?? 0) > 0 ? `troco + dinheiro − retiradas` : 'troco + dinheiro'}</small>
        </div>
      </div>
      <section className="bloco">
        <h3>Recebido por forma de pagamento</h3>
        {formas.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhuma conta fechada ainda.</p>
        ) : (
          <ul className="linhas-conta">
            {formas.map((f) => (
              <li key={f.id}><span className="linha-forma"><IconeForma forma={f.id} tamanho={15} /> {f.rotulo}</span><b>{brl(Number(r.por_forma[f.id]))}</b></li>
            ))}
          </ul>
        )}
      </section>
      {movimentos.length > 0 && (
        <section className="bloco">
          <h3>Retiradas e reforços</h3>
          <ul className="caixa__movimentos">
            {movimentos.map((m) => <LinhaMovimento key={m.id} m={m} />)}
          </ul>
        </section>
      )}
    </>
  );
}

function LinhaMovimento({ m }: { m: MovimentoCaixa }) {
  const retirada = m.tipo === 'retirada';
  return (
    <li>
      {retirada ? <ArrowUpCircle size={18} className="mov--saida" /> : <ArrowDownCircle size={18} className="mov--entrada" />}
      <div>
        <strong>{retirada ? 'Retirada' : 'Reforço de troco'}{m.motivo ? ` · ${m.motivo}` : ''}</strong>
        <small className="muted">{hora(m.criado_em)}{m.user_nome ? ` · ${m.user_nome}` : ''}</small>
      </div>
      <b className={retirada ? 'mov--saida' : 'mov--entrada'}>{retirada ? '−' : '+'} {brl(Number(m.valor))}</b>
    </li>
  );
}

function Resultado({ r, restaurante, aoConcluir, atualizar }: { r: ResumoCaixa; restaurante: string; aoConcluir: () => void; atualizar: boolean }) {
  const dif = r.diferenca;
  return (
    <div className="caixa">
      <div className="caixa__estado caixa__estado--ok">
        <CheckCircle2 size={28} />
        <div>
          <strong>Caixa fechado às {hora(r.ate)}</strong>
          <span>
            {dif === null || dif === undefined ? 'Sem conferência de dinheiro.'
              : Math.abs(Number(dif)) < 0.005 ? 'Dinheiro conferido: tudo certo.'
                : `${Number(dif) > 0 ? 'Sobra' : 'Falta'} de ${brl(Math.abs(Number(dif)))} no dinheiro.`}
          </span>
        </div>
      </div>
      <ResumoView r={r} />
      <div className="acoes-linha">
        <button className="btn btn--contorno" onClick={() => imprimirFechamento(r, restaurante, false)}><Printer size={18} /> Imprimir fechamento</button>
        <button className="btn btn--primario" style={{ flex: 1 }} onClick={aoConcluir}>
          {atualizar ? <><RefreshCw size={18} /> Concluir e atualizar o sistema</> : 'Concluir'}
        </button>
      </div>
    </div>
  );
}

/* ---------------- Aviso de atualização (não bloqueia a venda) ---------------- */
export function AvisoAtualizacao({ caixaAberto, aoAdiar }: { caixaAberto: boolean; aoAdiar: () => void }) {
  return (
    <div className="aviso-atualizacao" role="status">
      <div className="aviso-atualizacao__topo">
        <RefreshCw size={20} />
        <strong>Nova atualização do BasilFiery</strong>
      </div>
      <p>Leva poucos segundos e nenhum pedido é perdido. A atualização é obrigatória{caixaAberto ? ', mas você pode deixar para o fechamento do caixa' : ''}.</p>
      <div className="aviso-atualizacao__acoes">
        <button className="btn btn--primario btn--sm" onClick={aplicarAtualizacao}>Atualizar agora</button>
        {caixaAberto && <button className="btn btn--contorno btn--sm" onClick={aoAdiar}>Atualizar quando fechar o caixa</button>}
      </div>
    </div>
  );
}
