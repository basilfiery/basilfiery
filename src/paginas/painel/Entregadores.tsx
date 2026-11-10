import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bike, CircleCheck, Gift, HandCoins, KeyRound, MapPin, Plus, Send, Trash2 } from 'lucide-react';
import { Vazio } from '../../componentes/Basicos';
import { Avatar } from '../../componentes/Perfil';
import { LinkCopiavel, QrCartao } from '../../componentes/Link';
import { useToast } from '../../componentes/Toast';
import { confirmar } from '../../componentes/Confirmar';
import { msgErro, supabase } from '../../lib/supabase';
import type { Membro, Pedido } from '../../lib/tipos';
import { brl, hora, podeCaixa } from '../../lib/util';
import { usePainel } from './Painel';
import { ModalCadastrar, ModalEnviarAcesso, ModalNovaSenha, linkApp, type Acesso } from './Garcons';

/** Entrega já feita por um entregador (para corridas e acerto) */
type Corrida = Pick<Pedido, 'id' | 'numero' | 'criado_em' | 'entregue_em' | 'entregador_id' | 'entregador_nome' | 'taxa_entregador' | 'frete_gratis' | 'taxa_entrega' | 'endereco' | 'entregador_pago_em' | 'status'>;

const inicioDoDia = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const dataCurta = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

export default function Entregadores() {
  const { restaurante, papel, pedidos: aoVivo } = usePainel();
  const toast = useToast();
  const [lista, setLista] = useState<Membro[] | null>(null);
  const [corridas, setCorridas] = useState<Corrida[]>([]);
  const [cadastrando, setCadastrando] = useState(false);
  const [acesso, setAcesso] = useState<Acesso | null>(null);
  const [trocandoSenha, setTrocandoSenha] = useState<Membro | null>(null);
  const [acertando, setAcertando] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<string>('');

  const carregar = useCallback(async () => {
    const desde = new Date(Date.now() - 45 * 86400e3).toISOString();
    const [m, c] = await Promise.all([
      supabase.from('membros').select('*').eq('restaurante_id', restaurante.id).eq('papel', 'entregador').order('nome'),
      supabase.from('pedidos')
        .select('id, numero, criado_em, entregue_em, entregador_id, entregador_nome, taxa_entregador, frete_gratis, taxa_entrega, endereco, entregador_pago_em, status')
        .eq('restaurante_id', restaurante.id).eq('tipo', 'delivery').not('entregador_id', 'is', null)
        .gte('criado_em', desde).order('criado_em', { ascending: false }),
    ]);
    if (m.error) toast(msgErro(m.error), 'erro');
    setLista((m.data ?? []) as Membro[]);
    setCorridas((c.data ?? []) as Corrida[]);
  }, [restaurante.id, toast]);

  // Atualiza junto com os pedidos ao vivo (entrega saiu, foi entregue…)
  const assinatura = useMemo(() => aoVivo.filter((p) => p.tipo === 'delivery').map((p) => `${p.id}:${p.status}:${p.entregador_id ?? ''}:${p.saiu_em ?? ''}`).join('|'), [aoVivo]);
  useEffect(() => { void carregar(); }, [carregar, assinatura]);

  // Por entregador: em rota agora, hoje e a receber (não acertado)
  const resumo = useMemo(() => {
    const hoje = inicioDoDia();
    const r = new Map<string, { emRota: Pedido[]; hojeQtd: number; hojeValor: number; receberQtd: number; receber: number }>();
    for (const m of lista ?? []) r.set(m.user_id, { emRota: [], hojeQtd: 0, hojeValor: 0, receberQtd: 0, receber: 0 });
    for (const p of aoVivo) {
      if (p.tipo !== 'delivery' || !p.entregador_id || p.status === 'cancelado' || p.entregue_em || p.status === 'entregue') continue;
      r.get(p.entregador_id)?.emRota.push(p);
    }
    for (const c of corridas) {
      const x = c.entregador_id ? r.get(c.entregador_id) : undefined;
      if (!x || c.status !== 'entregue' || !c.entregue_em) continue;
      const valor = Number(c.taxa_entregador ?? 0);
      if (new Date(c.entregue_em).getTime() >= hoje) { x.hojeQtd++; x.hojeValor += valor; }
      if (!c.entregador_pago_em) { x.receberQtd++; x.receber += valor; }
    }
    return r;
  }, [lista, aoVivo, corridas]);

  async function remover(m: Membro) {
    if (!(await confirmar(`Remover ${m.nome}?\n\nA pessoa perde o acesso ao app de entregas.`, { sim: 'Remover', perigo: true }))) return;
    const { error } = await supabase.from('membros').delete().eq('restaurante_id', m.restaurante_id).eq('user_id', m.user_id);
    if (error) return toast(msgErro(error), 'erro');
    toast(`${m.nome} removido(a).`, 'ok');
    void carregar();
  }

  async function acertar(m: Membro, valor: number, qtd: number) {
    if (!(await confirmar(`Acertar ${qtd} ${qtd === 1 ? 'corrida' : 'corridas'} de ${m.nome}?\n\nTotal pago ao entregador: ${brl(valor)}.\nElas saem do “a receber” dele.`, { sim: `Pagar ${brl(valor)}` }))) return;
    setAcertando(m.user_id);
    const { data, error } = await supabase.rpc('entregador_acertar', { p_rest: restaurante.id, p_entregador: m.user_id });
    setAcertando(null);
    if (error) return toast(msgErro(error), 'erro');
    const r = data as { qtd: number; total: number };
    toast(`Acerto feito: ${r.qtd} ${r.qtd === 1 ? 'corrida' : 'corridas'} · ${brl(Number(r.total))} para ${m.nome}.`, 'ok');
    void carregar();
  }

  const visiveis = corridas.filter((c) => c.status === 'entregue' && (!filtro || c.entregador_id === filtro)).slice(0, 80);

  return (
    <div className="pagina">
      <div className="pagina__cab">
        <div style={{ flex: 1 }}>
          <h1 className="titulo">Entregadores</h1>
          <p>Cadastre os motoboys. No app do entregador eles veem as entregas em tempo real, saem para entregar e conferem as corridas para receber.</p>
        </div>
        <button className="btn btn--primario" onClick={() => setCadastrando(true)}><Plus size={18} /> Cadastrar entregador</button>
      </div>

      <div className="garcons">
        <section className="card garcons__lista">
          <h2 className="card__titulo">Equipe de entrega <small>{lista?.length ?? ''}</small></h2>
          {!lista ? null : lista.length === 0 ? (
            <Vazio icone={<Bike size={32} />} titulo="Nenhum entregador cadastrado">
              Clique em <b>Cadastrar entregador</b> para criar o primeiro acesso.
            </Vazio>
          ) : (
            <ul className="garcons__itens entr-lista">
              {lista.map((m) => {
                const x = resumo.get(m.user_id);
                return (
                  <li key={m.user_id}>
                    <Avatar nome={m.nome} foto={m.foto_url} tamanho={48} />
                    <div className="garcons__info">
                      <strong>{m.nome}</strong>
                      {x && x.emRota.length > 0
                        ? <span className="entr-status entr-status--rota"><Bike size={13} /> {x.emRota.some((p) => p.saiu_em) ? 'Em rota' : 'Separando'}: {x.emRota.map((p) => `#${p.numero}`).join(', ')}</span>
                        : <span className="entr-status"><CircleCheck size={13} /> Disponível</span>}
                      <small>Hoje: {x?.hojeQtd ?? 0} {x?.hojeQtd === 1 ? 'entrega' : 'entregas'} · {brl(x?.hojeValor ?? 0)}</small>
                    </div>
                    <div className="entr-receber">
                      <small>A receber</small>
                      <strong>{brl(x?.receber ?? 0)}</strong>
                      <span>{x?.receberQtd ?? 0} {x?.receberQtd === 1 ? 'corrida' : 'corridas'}</span>
                      {podeCaixa(papel) && (x?.receber ?? 0) > 0 && (
                        <button className="btn btn--sucesso btn--sm" disabled={acertando === m.user_id} onClick={() => void acertar(m, x!.receber, x!.receberQtd)}>
                          <HandCoins size={15} /> {acertando === m.user_id ? 'Acertando…' : 'Acertar'}
                        </button>
                      )}
                    </div>
                    <div className="acoes-linha">
                      <button className="btn btn--contorno btn--sm" onClick={() => setAcesso({ nome: m.nome, email: m.email ?? '' })}><Send size={16} /> Enviar acesso</button>
                      <button className="icone-btn" title="Nova senha" aria-label={`Nova senha para ${m.nome}`} onClick={() => setTrocandoSenha(m)}><KeyRound size={18} /></button>
                      <button className="icone-btn icone-btn--perigo" title="Remover" aria-label={`Remover ${m.nome}`} onClick={() => void remover(m)}><Trash2 size={18} /></button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="card garcons__acesso">
          <div className="garcons__acesso-cab">
            <h2 className="card__titulo">App do entregador</h2>
            <p>Link exclusivo dos motoboys: só aparecem as entregas.</p>
          </div>
          <LinkCopiavel link={linkApp(restaurante.codigo, undefined, 'entregador')} />
          <QrCartao link={linkApp(restaurante.codigo, undefined, 'entregador')} legenda="Aponte a câmera do celular" arquivo="qr-app-entregador" />
          <ol className="passos">
            <li><span>1</span><div>Abra o link no celular <small>ou leia o QR code com a câmera</small></div></li>
            <li><span>2</span><div>Entre com e-mail e senha <small>os que você cadastrou aqui</small></div></li>
            <li><span>3</span><div>Toque em <b>Ativar avisos</b> <small>para saber quando a entrega fica pronta</small></div></li>
          </ol>
        </aside>
      </div>

      <section className="card entr-corridas">
        <div className="entr-corridas__cab">
          <h2 className="card__titulo">Corridas <small>últimos 45 dias</small></h2>
          {(lista?.length ?? 0) > 1 && (
            <select className="select" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar por entregador">
              <option value="">Todos os entregadores</option>
              {lista!.map((m) => <option key={m.user_id} value={m.user_id}>{m.nome}</option>)}
            </select>
          )}
        </div>
        {visiveis.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhuma entrega feita ainda. Elas aparecem aqui quando o entregador marca “Entreguei”.</p>
        ) : (
          <div className="tabela-wrap">
            <table className="tabela entr-tabela">
              <thead><tr><th>Pedido</th><th>Entregue</th><th>Bairro</th><th>Entregador</th><th>Cliente pagou de entrega</th><th className="num">Corrida</th><th>Acerto</th></tr></thead>
              <tbody>
                {visiveis.map((c) => (
                  <tr key={c.id}>
                    <td><b>#{c.numero}</b></td>
                    <td>{c.entregue_em ? `${dataCurta(c.entregue_em)} ${hora(c.entregue_em)}` : '—'}</td>
                    <td><span className="entr-bairro"><MapPin size={13} /> {c.endereco?.bairro ?? '—'}</span></td>
                    <td>{c.entregador_nome ?? '—'}</td>
                    <td>{c.frete_gratis ? <span className="badge badge--frete"><Gift size={12} /> Frete grátis</span> : brl(Number(c.taxa_entrega ?? 0))}</td>
                    <td className="num"><b>{brl(Number(c.taxa_entregador ?? 0))}</b></td>
                    <td>{c.entregador_pago_em ? <span className="badge badge--verde">Pago {dataCurta(c.entregador_pago_em)}</span> : <span className="badge badge--amarelo">A receber</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {cadastrando && (
        <ModalCadastrar
          papel="entregador"
          restauranteId={restaurante.id}
          aoFechar={() => setCadastrando(false)}
          aoCriar={(a) => { setCadastrando(false); setAcesso(a); void carregar(); }}
        />
      )}
      {trocandoSenha && (
        <ModalNovaSenha
          membro={trocandoSenha}
          aoFechar={() => setTrocandoSenha(null)}
          aoSalvar={(senha) => { setAcesso({ nome: trocandoSenha.nome, email: trocandoSenha.email ?? '', senha }); setTrocandoSenha(null); }}
        />
      )}
      {acesso && <ModalEnviarAcesso app="entregador" acesso={acesso} restaurante={restaurante.nome} codigo={restaurante.codigo} aoFechar={() => setAcesso(null)} />}
    </div>
  );
}

