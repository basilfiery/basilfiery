/* Sugestão do campo "Alguma observação?" de acordo com o produto. */

const REGRAS: [RegExp, string][] = [
  [/chopp|chope|cerveja|long ?neck|heineken|brahma|skol|budweiser|stella|corona|original|antarctica|spaten|amstel|itaipava/, 'Ex.: sem colarinho, bem gelada'],
  [/caipirinha|caipiroska|drink|batida|gin|whisk|vodka|dose|coquetel|mojito|margarita|aperol/, 'Ex.: pouco gelo, menos doce'],
  [/refrigerante|refri|coca|guaran|fanta|sprite|pepsi|soda|t[oô]nica/, 'Ex.: com gelo e limão'],
  [/suco|limonada|laranjada|vitamina|smoothie/, 'Ex.: sem açúcar, pouco gelo'],
  [/[aá]gua/, 'Ex.: com gás, bem gelada'],
  [/caf[eé]|cappuccino|expresso|espresso|latte|ch[aá]\b|chocolate quente/, 'Ex.: sem açúcar, leite à parte'],
  [/a[cç]a[ií]|sorvete|milk ?shake|picol[eé]/, 'Ex.: sem granola, calda à parte'],
  [/pizza|calzone|esfiha|esfirra/, 'Ex.: sem cebola, bem assada'],
  [/hamb[uú]rguer|burger|smash|x-|cheese|lanche|sandu[ií]che|hot ?dog|cachorro/, 'Ex.: sem picles, carne ao ponto'],
  [/batata|fritas|polenta|mandioca|macaxeira|aipim|onion|an[eé]is|isca|por[cç][aã]o|petisco|frango a passarinho|calabresa acebolada/, 'Ex.: bem sequinha, molho à parte'],
  [/picanha|carne|fil[eé]|alcatra|costela|bife|churrasco|maminha|fraldinha|cupim|contra ?fil/, 'Ex.: carne ao ponto, sem cebola'],
  [/frango|galinha|peito/, 'Ex.: bem passado, sem pele'],
  [/peixe|til[aá]pia|salm[aã]o|camar[aã]o|fruto do mar|mariscos|sushi|sashimi|temaki|poke/, 'Ex.: sem cebolinha, molho à parte'],
  [/salada|bowl|wrap/, 'Ex.: sem tomate, molho à parte'],
  [/prato|executivo|marmita|marmitex|refei[cç][aã]o|feijoada|parmegiana|strogonoff|lasanha|macarr[aã]o|massa|risoto|escondidinho/, 'Ex.: sem feijão, arroz à parte'],
  [/pastel|coxinha|salgado|empada|quibe|kibe|enroladinho|risole/, 'Ex.: bem quentinho, molho à parte'],
  [/bolo|torta|pudim|doce|brownie|brigadeiro|mousse|sobremesa|petit|cheesecake|pav[eê]/, 'Ex.: sem calda, cobertura à parte'],
  [/tapioca|crepe|panqueca|omelete|ovo/, 'Ex.: sem queijo, bem passado'],
];

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Olha o nome (e categoria/descrição) e sugere o que as pessoas costumam pedir para aquele tipo de item. */
export function sugerirObs(...textos: (string | null | undefined)[]) {
  const t = semAcento(textos.filter(Boolean).join(' '));
  for (const [re, dica] of REGRAS) if (re.test(t)) return dica;
  return 'Ex.: alguma preferência no preparo?';
}
