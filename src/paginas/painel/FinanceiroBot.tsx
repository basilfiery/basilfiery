import { useCallback, useEffect, useState } from 'react';
import { Bot, Camera, Check, Clock, MessageCircle, Phone, Plus, Trash2 } from 'lucide-react';
import { Campo, Vazio } from '../../componentes/Basicos';
import { Carregando } from '../../componentes/Carregando';
import { useToast } from '../../componentes/Toast';
import { confirmar } from '../../componentes/Confirmar';
import { msgErro, supabase } from '../../lib/supabase';
import { cx, hora } from '../../lib/util';

/* Bot do WhatsApp do financeiro: números autorizados e o que chegou por lá */

interface Numero { id: string; telefone: string; nome: string; ativo: boolean; criado_em: string }
interface Mensagem { id: string; telefone: string; tipo: string; texto: string | null; resposta: string | null; lancamento_id: string | null; criado_em: string }

/** "(11) 98765-4321" → "5511987654321" */
function normalizarTel(t: string) {
  let d = t.replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d;
}
const telBonito = (d: string) => d.replace(/^55(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');
const quando = (iso: string) => `${new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora(iso)}`;

export function BotWhatsApp({ restauranteId }: { restauranteId: string }) {
  const toast = useToast();
  const [numeros, setNumeros] = useState<Numero[] | null>(null);
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [bot, setBot] = useState<string | null | undefined>(undefined);
  const [novo, setNovo] = useState({ nome: '', tel: '' });
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      supabase.from('fin_bot_numeros').select('*').eq('restaurante_id', restauranteId).order('criado_em'),
      supabase.from('fin_bot_mensagens').select('id, telefone, tipo, texto, resposta, lancamento_id, criado_em').eq('restaurante_id', restauranteId).order('criado_em', { ascending: false }).limit(20),
      supabase.rpc('fin_bot_info'),
    ]);
    if (a.error) toast(msgErro(a.error), 'erro');
    setNumeros((a.data ?? []) as Numero[]);
    setMsgs((b.data ?? []) as Mensagem[]);
    setBot(((c.data ?? {}) as { numero?: string | null }).numero ?? null);
  }, [restauranteId, toast]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function adicionar() {
    const tel = normalizarTel(novo.tel);
    if (!/^55\d{10,11}$/.test(tel)) return toast('Digite o WhatsApp com DDD. Ex.: (11) 98765-4321', 'erro');
    setOcupado(true);
    const { error } = await supabase.from('fin_bot_numeros').insert({ restaurante_id: restauranteId, telefone: tel, nome: novo.nome.trim() });
    setOcupado(false);
    if (error) return toast(error.code === '23505' ? 'Esse número já está cadastrado (nesta ou em outra loja).' : msgErro(error), 'erro');
    toast('Número liberado. Já pode mandar os comprovantes!', 'ok');
    setNovo({ nome: '', tel: '' });
    void carregar();
  }
  async function remover(n: Numero) {
    if (!(await confirmar(`Tirar ${telBonito(n.telefone)} do bot? Esse número para de lançar no financeiro.`, { sim: 'Tirar', perigo: true }))) return;
    const { error } = await supabase.from('fin_bot_numeros').delete().eq('id', n.id);
    if (error) return toast(msgErro(error), 'erro');
    void carregar();
  }

  const link = bot ? `https://wa.me/${bot}?text=${encodeURIComponent('oi')}` : null;

  return (
    <div className="fin__bot">
      <section className="card fin__bot-hero">
        <span className="fin__bot-icone"><Bot size={28} /></span>
        <div>
          <h2>Mande o comprovante, o sistema lança sozinho</h2>
          <p>Tire uma foto da nota, do cupom, do recibo ou do comprovante do Pix e mande para o bot no WhatsApp. Sem nota? Escreva: <i>“comprei 3 kg de queijo por 120 no pix”</i>. A despesa entra no Financeiro com valor, categoria, fornecedor e a foto guardada.</p>
          <div className="fin__bot-exemplos">
            <span><Camera size={15} /> Foto do comprovante</span>
            <span><MessageCircle size={15} /> “gás 130 dinheiro”</span>
            <span><Clock size={15} /> “resumo”, “contas”, “desfazer”</span>
          </div>
        </div>
        <div className="fin__bot-num">
          {bot === undefined ? null : bot ? (
            <>
              <small>Número do bot</small>
              <strong>{telBonito(bot)}</strong>
              <a className="btn btn--whats btn--sm" href={link!} target="_blank" rel="noopener"><MessageCircle size={15} /> Abrir no WhatsApp</a>
            </>
          ) : (
            <>
              <small>Número do bot</small>
              <strong className="fin__bot-breve">Em ativação</strong>
              <span className="muted">Cadastre seu número abaixo: assim que o bot for ligado, já funciona.</span>
            </>
          )}
        </div>
      </section>

      <section className="card">
        <h2 className="card__titulo"><Phone size={18} /> Quem pode mandar</h2>
        <p className="muted">Só os números cadastrados aqui lançam no financeiro desta loja. Mensagens de outros números são ignoradas.</p>
        {!numeros ? <Carregando /> : (
          <>
            {numeros.length > 0 && (
              <ul className="fin__lista">
                {numeros.map((n) => (
                  <li key={n.id} className="fin__linha">
                    <span className="fin__linha-icone"><Phone size={17} /></span>
                    <div className="fin__linha-txt"><b>{telBonito(n.telefone)}</b><small>{n.nome || 'Sem nome'}</small></div>
                    <span className={cx('badge', n.ativo ? 'badge--verde' : '')}>{n.ativo ? 'Liberado' : 'Pausado'}</span>
                    <span className="fin__linha-acoes"><button className="icone-btn icone-btn--perigo" title="Tirar" aria-label="Tirar número" onClick={() => void remover(n)}><Trash2 size={16} /></button></span>
                  </li>
                ))}
              </ul>
            )}
            <div className="form-linha fin__bot-novo">
              <Campo rotulo="WhatsApp (com DDD)"><input className="input" inputMode="tel" value={novo.tel} onChange={(e) => setNovo({ ...novo, tel: e.target.value })} placeholder="(11) 98765-4321" /></Campo>
              <Campo rotulo="De quem é"><input className="input" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} placeholder="Ex.: Adriano (dono)" /></Campo>
              <button className="btn btn--primario" disabled={ocupado || !novo.tel.trim()} onClick={() => void adicionar()}><Plus size={16} /> Liberar número</button>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2 className="card__titulo"><MessageCircle size={18} /> Últimas mensagens</h2>
        {msgs.length === 0 ? <Vazio icone={<Bot size={28} />} titulo="Nada recebido ainda">Quando você mandar um comprovante, ele aparece aqui.</Vazio> : (
          <ul className="fin__msgs">
            {msgs.map((m) => (
              <li key={m.id}>
                <div className="fin__msg-cab">
                  <b>{telBonito(m.telefone)}</b>
                  <small>{quando(m.criado_em)} · {m.tipo === 'image' ? 'foto' : m.tipo === 'document' ? 'arquivo' : m.tipo === 'audio' ? 'áudio' : 'texto'}</small>
                  {m.lancamento_id && <span className="badge badge--verde"><Check size={12} /> Lançado</span>}
                </div>
                {m.texto && <p className="fin__msg-in">{m.texto}</p>}
                {m.resposta && <p className="fin__msg-out">{m.resposta}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
