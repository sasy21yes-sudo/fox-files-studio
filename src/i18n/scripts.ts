import type { MkSceneId } from '../types';
import { MKULTRA_SCRIPT, SHORT_HOOK, type Beat } from '../data/mkultraScript';
import type { Lang } from './languages';

/**
 * The episode script in every narration language.
 *
 * Translations follow the English script sentence by sentence: the same facts,
 * numbers, names and dates, all limited to the bundled sources. Only the
 * wording changes, so the pacing and the pop-ups (beats) line up the same way.
 * Kennedy's line stays a paraphrase in every language, never a quotation.
 */
export interface LocalizedScene {
  title: string;
  narration: string;
  keywords: string[];
  beats: Beat[];
}

export interface LocalizedScript {
  episodeTitle: string;
  episodeSubtitle: string;
  hook: { text: string; keywords: string[] };
  scenes: Record<MkSceneId, LocalizedScene>;
  /**
   * Pronunciation hints for the neural narrator only (subtitles keep the real
   * spelling): [written, spoken] pairs, matched as whole words.
   */
  say: [string, string][];
}

const english: LocalizedScript = {
  episodeTitle: 'MKUltra: The Secret Experiments',
  episodeSubtitle: 'What the Documents Actually Revealed',
  hook: { text: SHORT_HOOK.text, keywords: SHORT_HOOK.keywords },
  scenes: Object.fromEntries(
    MKULTRA_SCRIPT.map((e) => [e.id, { title: e.title, narration: e.narration, keywords: e.keywords, beats: e.beats }]),
  ) as Record<MkSceneId, LocalizedScene>,
  say: [['MKUltra', 'M K Ultra']],
};

const italian: LocalizedScript = {
  episodeTitle: 'MKUltra: gli esperimenti segreti',
  episodeSubtitle: 'Cosa rivelarono davvero i documenti',
  hook: {
    text: 'La CIA ha drogato persone che non ne sapevano nulla. È scritto negli atti del Senato.',
    keywords: ['CIA', 'non ne sapevano nulla', 'atti del Senato'],
  },
  scenes: {
    file: {
      title: 'Il fascicolo',
      narration:
        "Nel 1977, il Senato degli Stati Uniti tenne un'audizione su un programma segreto della CIA. I suoi documenti erano stati distrutti anni prima. Ma non tutti. Il programma si chiamava MKUltra. Quindi, che cos'era? E come facciamo a saperlo?",
      keywords: ['1977', 'programma segreto della CIA', 'distrutta', 'MKUltra'],
      beats: [
        { cue: 'Ma non tutti', kind: 'statement', lines: ['DOCUMENTI: DISTRUTTI NEL 1973', 'ALCUNI: RITROVATI NEL 1977'] },
        { cue: 'come facciamo a saperlo?', kind: 'question', text: "Cos'era? Come lo sappiamo?" },
      ],
    },
    question: {
      title: 'Gli atti',
      narration:
        'Partiamo da ciò che la CIA stessa disse al Senato. Secondo la testimonianza del direttore della CIA, MKUltra andò avanti dal 1953 al 1964. Sono undici anni. I documenti sopravvissuti elencano 149 sottoprogetti. Citano 80 istituzioni, e 44 di queste erano college e università. Citano anche 185 ricercatori e assistenti esterni al governo.',
      keywords: ['1953', '1964', 'undici anni', '149 sottoprogetti', '80 istituzioni', '44', '185'],
      beats: [
        { cue: 'Sono undici anni', kind: 'span', from: '1953', to: '1964', label: '11 ANNI' },
        { cue: '185 ricercatori', kind: 'count', value: 185, label: 'RICERCATORI ESTERNI', note: 'e assistenti citati nei documenti' },
      ],
    },
    experiments: {
      title: 'Gli esperimenti',
      narration:
        "Ma cosa facevano, in concreto, tutti questi sottoprogetti? Il direttore li divise in categorie. Tra queste: droghe e alcol. Ipnosi. Ricerca sul sonno. Macchina della verità. Gli atti parlano anche di droghe pensate come aiuto negli interrogatori. Tra le droghe testate c'era l'LSD. E qui arriva la parte più importante. Alcune delle persone testate erano volontari. Ad altre non fu mai detto nulla.",
      keywords: ['categorie', 'LSD', 'interrogatori', 'volontari', 'non fu mai detto nulla'],
      beats: [
        { cue: 'in concreto', kind: 'question', text: 'Cosa facevano davvero?' },
        { cue: 'Ricerca sul sonno', kind: 'list', title: 'ALCUNE CATEGORIE', items: ['DROGHE E ALCOL', 'IPNOSI', 'RICERCA SUL SONNO', 'MACCHINA DELLA VERITÀ'] },
        { cue: 'non fu mai detto nulla', kind: 'versus', left: 'VOLONTARI', right: 'MAI AVVISATI', caption: 'Due tipi molto diversi di soggetti' },
      ],
    },
    cost: {
      title: 'Il costo umano',
      narration:
        "Secondo la testimonianza, sei sottoprogetti testarono droghe su persone ignare. Ignare significa che non lo sapevano. Alcuni di quei test avvennero in case sicure a San Francisco e a New York. Non c'era alcun consenso informato. Un caso mostra cosa significasse. Il dottor Frank Olson era un dipendente civile dell'Esercito. Nel 1953, durante una riunione organizzata dalla CIA, gli fu dato dell'LSD a sua insaputa. Circa una settimana dopo, era morto.",
      keywords: ['sei sottoprogetti', 'ignare', 'case sicure', 'consenso informato', 'Frank Olson'],
      beats: [
        { cue: 'sei sottoprogetti', kind: 'waffle', total: 149, hit: 6, label: '6 SU 149 SOTTOPROGETTI', note: 'testarono droghe su persone che non sapevano' },
        { cue: 'Ignare significa', kind: 'define', word: 'i·gnà·ro', pos: 'aggettivo', meaning: 'che non sa; inconsapevole di ciò che sta succedendo' },
        { cue: 'alcun consenso informato', kind: 'define', word: 'con·sen·so in·for·mà·to', pos: 'sostantivo', meaning: 'accettare un esperimento dopo che ti è stato spiegato cosa comporta' },
      ],
    },
    revelation: {
      title: 'La rivelazione',
      narration:
        "Quindi, come venne fuori tutto questo? Nel gennaio 1975, il Senato creò una commissione speciale, presieduta dal senatore Frank Church. Il suo compito era scoprire se le agenzie di intelligence americane avessero fatto qualcosa di illegale, scorretto o immorale. Poi, nel 1977, un dipendente della CIA trovò sette scatole di documenti di MKUltra in un archivio di documenti dismessi. Quell'agosto, i senatori interrogarono il direttore della CIA in un'audizione congiunta. Il senatore Edward Kennedy disse che la CIA aveva drogato cittadini americani senza che lo sapessero e senza il loro consenso.",
      keywords: ['Frank Church', 'illegale, scorretto o immorale', 'sette scatole', 'audizione congiunta', 'Edward Kennedy'],
      beats: [
        { cue: 'venne fuori', kind: 'question', text: 'Come venne fuori?' },
        { cue: 'illegale, scorretto o immorale', kind: 'list', items: ['ILLEGALE?', 'SCORRETTO?', 'IMMORALE?'] },
        {
          cue: 'Il senatore Edward Kennedy disse',
          kind: 'record',
          tag: 'SENATO USA · 3 AGO 1977',
          who: 'Sen. Edward Kennedy',
          text: 'La CIA ha drogato cittadini americani senza che lo sapessero e senza il loro consenso.',
          highlight: 'senza che lo sapessero e senza il loro consenso',
          note: "Parafrasi dal verbale dell'audizione",
        },
      ],
    },
    known: {
      title: 'Cosa sappiamo',
      narration:
        "Ma quelle scatole non erano mai state tutta la storia. Un rapporto del 1963 dell'Ispettore generale della CIA portò alla fine dei test su persone ignare nel 1964. E nel 1973, i file di MKUltra furono distrutti su autorizzazione dell'allora direttore della CIA. Il senatore Kennedy fece il suo nome: Richard Helms. Ciò che sopravvisse erano soprattutto fascicoli finanziari. Anticipi, giustificativi, rendiconti. Quindi, cosa sappiamo davvero? Abbastanza per dimostrare che è successo. Non abbastanza per sapere tutto ciò che è successo. Gran parte della storia completa potrebbe non venire mai alla luce.",
      keywords: ['1963', '1964', '1973', 'distrutti', 'Richard Helms', 'fascicoli finanziari', 'non venire mai alla luce'],
      beats: [
        { cue: 'fine dei test', kind: 'span', from: 'Rapporto 1963', to: '1964', label: 'FINE DEI TEST SU IGNARI' },
        { cue: 'Anticipi, giustificativi', kind: 'list', title: 'COSA È SOPRAVVISSUTO', items: ['ANTICIPI', 'GIUSTIFICATIVI', 'RENDICONTI'] },
        { cue: 'Abbastanza per dimostrare', kind: 'statement', lines: ['ABBASTANZA PER DIMOSTRARE', 'CHE È SUCCESSO.'] },
        { cue: 'Non abbastanza per sapere', kind: 'statement', lines: ['NON ABBASTANZA PER SAPERE', 'TUTTO CIÒ CHE È SUCCESSO.'] },
      ],
    },
  },
  say: [
    ['MKUltra', 'emme kappa ultra'],
    ['Church', 'Ciòrc'],
    ['New York', 'Niu Iòrk'],
    ['college', 'còlleg'],
  ],
};

const spanish: LocalizedScript = {
  episodeTitle: 'MKUltra: los experimentos secretos',
  episodeSubtitle: 'Lo que revelaron de verdad los documentos',
  hook: {
    text: 'La CIA drogó a personas que nunca lo supieron. Está en el acta del Senado.',
    keywords: ['CIA', 'nunca lo supieron', 'acta del Senado'],
  },
  scenes: {
    file: {
      title: 'El expediente',
      narration:
        'En 1977, el Senado de Estados Unidos celebró una audiencia sobre un programa secreto de la CIA. Sus archivos se habían destruido años antes. Pero no todos. El programa se llamaba MKUltra. Entonces, ¿qué era? ¿Y cómo lo sabemos?',
      keywords: ['1977', 'programa secreto de la CIA', 'destruido', 'MKUltra'],
      beats: [
        { cue: 'Pero no todos', kind: 'statement', lines: ['ARCHIVOS: DESTRUIDOS EN 1973', 'ALGUNOS: HALLADOS EN 1977'] },
        { cue: 'cómo lo sabemos?', kind: 'question', text: '¿Qué era? ¿Cómo lo sabemos?' },
      ],
    },
    question: {
      title: 'El registro',
      narration:
        'Empecemos por lo que la propia CIA le contó al Senado. Según el testimonio del director de la CIA, MKUltra funcionó de 1953 a 1964. Son once años. Los registros que sobrevivieron enumeran 149 subproyectos. Nombran 80 instituciones, y 44 de ellas eran universidades y otros centros de educación superior. También nombran a 185 investigadores y asistentes ajenos al gobierno.',
      keywords: ['1953', '1964', 'once años', '149 subproyectos', '80 instituciones', '44', '185'],
      beats: [
        { cue: 'Son once años', kind: 'span', from: '1953', to: '1964', label: '11 AÑOS' },
        { cue: '185 investigadores', kind: 'count', value: 185, label: 'INVESTIGADORES EXTERNOS', note: 'y asistentes nombrados en los registros' },
      ],
    },
    experiments: {
      title: 'Los experimentos',
      narration:
        'Entonces, ¿qué hacían en realidad todos estos subproyectos? El director los clasificó en categorías. Entre ellas: drogas y alcohol. Hipnosis. Investigación del sueño. Polígrafos. El registro también incluye drogas pensadas como ayuda en los interrogatorios. El LSD estaba entre las drogas probadas. Y esta es la parte que más importa. Algunas de las personas estudiadas eran voluntarias. A otras nunca se lo dijeron.',
      keywords: ['categorías', 'LSD', 'interrogatorios', 'voluntarias', 'nunca se lo dijeron'],
      beats: [
        { cue: 'en realidad', kind: 'question', text: '¿Qué hacían en realidad?' },
        { cue: 'Investigación del sueño', kind: 'list', title: 'ALGUNAS CATEGORÍAS', items: ['DROGAS Y ALCOHOL', 'HIPNOSIS', 'INVESTIGACIÓN DEL SUEÑO', 'POLÍGRAFOS'] },
        { cue: 'nunca se lo dijeron', kind: 'versus', left: 'VOLUNTARIOS', right: 'NUNCA LO SUPIERON', caption: 'Dos tipos muy distintos de sujetos de prueba' },
      ],
    },
    cost: {
      title: 'El coste humano',
      narration:
        'Según el testimonio, seis subproyectos probaron drogas en personas desprevenidas. Desprevenidas significa que no lo sabían. Algunas de esas pruebas se hicieron en pisos francos de San Francisco y Nueva York. No hubo consentimiento informado. Un caso muestra lo que eso significaba. El doctor Frank Olson era un empleado civil del Ejército. En 1953, en una reunión convocada por la CIA, le dieron LSD sin que lo supiera. Más o menos una semana después, estaba muerto.',
      keywords: ['seis subproyectos', 'desprevenidas', 'pisos francos', 'consentimiento informado', 'Frank Olson'],
      beats: [
        { cue: 'seis subproyectos', kind: 'waffle', total: 149, hit: 6, label: '6 DE 149 SUBPROYECTOS', note: 'probaron drogas en personas que no lo sabían' },
        { cue: 'Desprevenidas significa', kind: 'define', word: 'des·pre·ve·ni·do', pos: 'adjetivo', meaning: 'que no sabe ni se espera lo que está pasando' },
        { cue: 'No hubo consentimiento', kind: 'define', word: 'con·sen·ti·mien·to in·for·ma·do', pos: 'sustantivo', meaning: 'aceptar un experimento después de que te expliquen en qué consiste' },
      ],
    },
    revelation: {
      title: 'La revelación',
      narration:
        'Entonces, ¿cómo salió todo esto a la luz? En enero de 1975, el Senado creó un comité especial, presidido por el senador Frank Church. Su tarea era averiguar si las agencias de inteligencia de Estados Unidos habían hecho algo ilegal, indebido o poco ético. Después, en 1977, un empleado de la CIA encontró siete cajas de registros de MKUltra en un centro de archivos inactivos. Ese agosto, los senadores interrogaron al director de la CIA en una audiencia conjunta. El senador Edward Kennedy dijo que la CIA había drogado a ciudadanos estadounidenses sin su conocimiento ni su consentimiento.',
      keywords: ['Frank Church', 'ilegal, indebido o poco ético', 'siete cajas', 'audiencia conjunta', 'Edward Kennedy'],
      beats: [
        { cue: 'salió todo esto a la luz', kind: 'question', text: '¿Cómo salió a la luz?' },
        { cue: 'ilegal, indebido o poco ético', kind: 'list', items: ['¿ILEGAL?', '¿INDEBIDO?', '¿POCO ÉTICO?'] },
        {
          cue: 'El senador Edward Kennedy dijo',
          kind: 'record',
          tag: 'SENADO DE EE. UU. · 3 AGO 1977',
          who: 'Sen. Edward Kennedy',
          text: 'La CIA drogó a ciudadanos estadounidenses sin su conocimiento ni su consentimiento.',
          highlight: 'sin su conocimiento ni su consentimiento',
          note: 'Paráfrasis del acta de la audiencia',
        },
      ],
    },
    known: {
      title: 'Lo que sabemos',
      narration:
        'Pero esas cajas nunca fueron toda la historia. Un informe de 1963 del Inspector General de la CIA llevó al fin de las pruebas en personas desprevenidas en 1964. Y en 1973, los archivos de MKUltra fueron destruidos con la autorización del entonces director de la CIA. El senador Kennedy dijo su nombre: Richard Helms. Lo que sobrevivió fueron sobre todo carpetas financieras. Anticipos, comprobantes, rendiciones de cuentas. Entonces, ¿qué sabemos realmente? Lo suficiente para demostrar que ocurrió. No lo suficiente para saber todo lo que ocurrió. Puede que gran parte de la historia completa nunca llegue a conocerse.',
      keywords: ['1963', '1964', '1973', 'destruidos', 'Richard Helms', 'carpetas financieras', 'nunca llegue a conocerse'],
      beats: [
        { cue: 'fin de las pruebas', kind: 'span', from: 'Informe 1963', to: '1964', label: 'FIN DE LAS PRUEBAS SIN AVISO' },
        { cue: 'Anticipos, comprobantes', kind: 'list', title: 'LO QUE SOBREVIVIÓ', items: ['ANTICIPOS', 'COMPROBANTES', 'CUENTAS'] },
        { cue: 'Lo suficiente para demostrar', kind: 'statement', lines: ['LO SUFICIENTE PARA DEMOSTRAR', 'QUE OCURRIÓ.'] },
        { cue: 'No lo suficiente para saber', kind: 'statement', lines: ['NO LO SUFICIENTE PARA SABER', 'TODO LO QUE OCURRIÓ.'] },
      ],
    },
  },
  say: [
    ['MKUltra', 'eme ka ultra'],
    ['Church', 'Chorch'],
  ],
};

const french: LocalizedScript = {
  episodeTitle: 'MKUltra : les expériences secrètes',
  episodeSubtitle: 'Ce que les documents ont vraiment révélé',
  hook: {
    text: "La CIA a drogué des gens qui n'en savaient rien. C'est dans les archives du Sénat.",
    keywords: ['CIA', "n'en savaient rien", 'archives du Sénat'],
  },
  scenes: {
    file: {
      title: 'Le dossier',
      narration:
        "En 1977, le Sénat des États-Unis a tenu une audition sur un programme secret de la CIA. Ses archives avaient été détruites des années plus tôt. Mais pas toutes. Le programme s'appelait MKUltra. Alors, qu'est-ce que c'était ? Et comment le sait-on ?",
      keywords: ['1977', 'programme secret de la CIA', 'détruites', 'MKUltra'],
      beats: [
        { cue: 'Mais pas toutes', kind: 'statement', lines: ['ARCHIVES : DÉTRUITES EN 1973', 'UNE PARTIE : RETROUVÉE EN 1977'] },
        { cue: 'comment le sait-on', kind: 'question', text: "C'était quoi ? Comment le sait-on ?" },
      ],
    },
    question: {
      title: 'Les archives',
      narration:
        "Commençons par ce que la CIA elle-même a dit au Sénat. Selon le témoignage du directeur de la CIA, MKUltra a duré de 1953 à 1964. Soit onze ans. Les archives qui ont survécu recensent 149 sous-projets. Elles citent 80 institutions, dont 44 universités et établissements d'enseignement supérieur. Elles citent aussi 185 chercheurs et assistants extérieurs au gouvernement.",
      keywords: ['1953', '1964', 'onze ans', '149 sous-projets', '80 institutions', '44', '185'],
      beats: [
        { cue: 'Soit onze ans', kind: 'span', from: '1953', to: '1964', label: '11 ANS' },
        { cue: '185 chercheurs', kind: 'count', value: 185, label: 'CHERCHEURS EXTÉRIEURS', note: 'et assistants cités dans les archives' },
      ],
    },
    experiments: {
      title: 'Les expériences',
      narration:
        "Alors, que faisaient concrètement tous ces sous-projets ? Le directeur les a classés par catégories. Parmi elles : drogues et alcool. Hypnose. Recherche sur le sommeil. Détecteurs de mensonge. Les archives évoquent aussi des drogues destinées à faciliter les interrogatoires. Le LSD faisait partie des drogues testées. Et voici le plus important. Certaines des personnes testées étaient volontaires. D'autres n'ont jamais été prévenues.",
      keywords: ['catégories', 'LSD', 'interrogatoires', 'volontaires', 'jamais été prévenues'],
      beats: [
        { cue: 'concrètement', kind: 'question', text: 'Que faisaient-ils vraiment ?' },
        { cue: 'Recherche sur le sommeil', kind: 'list', title: 'QUELQUES CATÉGORIES', items: ['DROGUES ET ALCOOL', 'HYPNOSE', 'SOMMEIL', 'DÉTECTEUR DE MENSONGE'] },
        { cue: 'jamais été prévenues', kind: 'versus', left: 'VOLONTAIRES', right: 'JAMAIS PRÉVENUS', caption: 'Deux types de sujets très différents' },
      ],
    },
    cost: {
      title: 'Le coût humain',
      narration:
        "Selon le témoignage, six sous-projets ont testé des drogues sur des personnes à leur insu. À leur insu, ça veut dire sans le savoir. Certains de ces tests ont eu lieu dans des planques à San Francisco et à New York. Il n'y avait aucun consentement éclairé. Un cas montre ce que cela voulait dire. Le docteur Frank Olson était un employé civil de l'armée. En 1953, lors d'une réunion organisée par la CIA, on lui a fait prendre du LSD à son insu. Environ une semaine plus tard, il était mort.",
      keywords: ['six sous-projets', 'à leur insu', 'planques', 'consentement éclairé', 'Frank Olson'],
      beats: [
        { cue: 'six sous-projets', kind: 'waffle', total: 149, hit: 6, label: '6 SUR 149 SOUS-PROJETS', note: 'ont testé des drogues sur des gens qui ne savaient pas' },
        { cue: 'ça veut dire', kind: 'define', word: "à l'in·su de", pos: 'locution', meaning: 'sans que la personne le sache' },
        { cue: 'aucun consentement éclairé', kind: 'define', word: 'con·sen·te·ment é·clai·ré', pos: 'nom', meaning: "accepter une expérience après avoir été informé de ce qu'elle implique" },
      ],
    },
    revelation: {
      title: 'La révélation',
      narration:
        "Alors, comment tout cela a-t-il été découvert ? En janvier 1975, le Sénat a créé une commission spéciale, présidée par le sénateur Frank Church. Sa mission était de découvrir si les agences de renseignement américaines avaient fait quoi que ce soit d'illégal, d'inapproprié ou de contraire à l'éthique. Puis, en 1977, un employé de la CIA a retrouvé sept cartons d'archives de MKUltra dans un centre d'archives pour dossiers inactifs. En août de la même année, les sénateurs ont interrogé le directeur de la CIA lors d'une audition conjointe. Le sénateur Edward Kennedy a déclaré que la CIA avait drogué des citoyens américains à leur insu et sans leur consentement.",
      keywords: ['Frank Church', "d'illégal, d'inapproprié ou de contraire à l'éthique", 'sept cartons', 'audition conjointe', 'Edward Kennedy'],
      beats: [
        { cue: 'été découvert', kind: 'question', text: "Comment l'a-t-on su ?" },
        { cue: "d'illégal, d'inapproprié", kind: 'list', items: ['ILLÉGAL ?', 'INAPPROPRIÉ ?', "CONTRAIRE À L'ÉTHIQUE ?"] },
        {
          cue: 'Le sénateur Edward Kennedy a déclaré',
          kind: 'record',
          tag: 'SÉNAT DES ÉTATS-UNIS · 3 AOÛT 1977',
          who: 'Sén. Edward Kennedy',
          text: 'La CIA a drogué des citoyens américains à leur insu et sans leur consentement.',
          highlight: 'à leur insu et sans leur consentement',
          note: "Paraphrase du compte rendu de l'audition",
        },
      ],
    },
    known: {
      title: "Ce que l'on sait",
      narration:
        "Mais ces cartons n'ont jamais été toute l'histoire. Un rapport de 1963 de l'inspecteur général de la CIA a mené à la fin des tests à l'insu des sujets en 1964. Et en 1973, les dossiers de MKUltra ont été détruits sur l'autorité du directeur de la CIA de l'époque. Le sénateur Kennedy l'a nommé : Richard Helms. Ce qui a survécu, ce sont surtout des dossiers financiers. Des avances, des pièces justificatives, des comptes. Alors, que sait-on vraiment ? Assez pour montrer que c'est arrivé. Pas assez pour savoir tout ce qui est arrivé. Une grande partie de l'histoire complète ne sera peut-être jamais connue.",
      keywords: ['1963', '1964', '1973', 'détruits', 'Richard Helms', 'dossiers financiers', 'jamais connue'],
      beats: [
        { cue: 'fin des tests', kind: 'span', from: 'Rapport 1963', to: '1964', label: "FIN DES TESTS À L'INSU" },
        { cue: 'Des avances, des pièces', kind: 'list', title: 'CE QUI A SURVÉCU', items: ['AVANCES', 'JUSTIFICATIFS', 'COMPTES'] },
        { cue: 'Assez pour montrer', kind: 'statement', lines: ['ASSEZ POUR MONTRER', "QUE C'EST ARRIVÉ."] },
        { cue: 'Pas assez pour savoir', kind: 'statement', lines: ['PAS ASSEZ POUR SAVOIR', 'TOUT CE QUI EST ARRIVÉ.'] },
      ],
    },
  },
  say: [
    ['MKUltra', 'ème ka ultra'],
    ['Church', 'Tcheurtch'],
    ['New York', 'Niou York'],
  ],
};

const portuguese: LocalizedScript = {
  episodeTitle: 'MKUltra: os experimentos secretos',
  episodeSubtitle: 'O que os documentos realmente revelaram',
  hook: {
    text: 'A CIA drogou pessoas que nunca souberam. Está nos registros do Senado.',
    keywords: ['CIA', 'nunca souberam', 'registros do Senado'],
  },
  scenes: {
    file: {
      title: 'O arquivo',
      narration:
        'Em 1977, o Senado dos Estados Unidos fez uma audiência sobre um programa secreto da CIA. Seus arquivos tinham sido destruídos anos antes. Mas não todos. O programa se chamava MKUltra. Então, o que era? E como a gente sabe?',
      keywords: ['1977', 'programa secreto da CIA', 'destruída', 'MKUltra'],
      beats: [
        { cue: 'Mas não todos', kind: 'statement', lines: ['ARQUIVOS: DESTRUÍDOS EM 1973', 'ALGUNS: ENCONTRADOS EM 1977'] },
        { cue: 'como a gente sabe?', kind: 'question', text: 'O que era? Como a gente sabe?' },
      ],
    },
    question: {
      title: 'O registro',
      narration:
        'Vamos começar pelo que a própria CIA contou ao Senado. Segundo o depoimento do diretor da CIA, o MKUltra funcionou de 1953 a 1964. São onze anos. Os registros que sobreviveram listam 149 subprojetos. Eles citam 80 instituições, e 44 delas eram faculdades e universidades. Também citam 185 pesquisadores e assistentes de fora do governo.',
      keywords: ['1953', '1964', 'onze anos', '149 subprojetos', '80 instituições', '44', '185'],
      beats: [
        { cue: 'São onze anos', kind: 'span', from: '1953', to: '1964', label: '11 ANOS' },
        { cue: '185 pesquisadores', kind: 'count', value: 185, label: 'PESQUISADORES EXTERNOS', note: 'e assistentes citados nos registros' },
      ],
    },
    experiments: {
      title: 'Os experimentos',
      narration:
        'Então, o que todos esses subprojetos faziam de verdade? O diretor os dividiu em categorias. Entre elas: drogas e álcool. Hipnose. Pesquisa sobre o sono. Polígrafos. O registro também fala de drogas pensadas para ajudar em interrogatórios. O LSD estava entre as drogas testadas. E aqui está a parte que mais importa. Algumas das pessoas testadas eram voluntárias. Outras nunca foram avisadas.',
      keywords: ['categorias', 'LSD', 'interrogatórios', 'voluntárias', 'nunca foram avisadas'],
      beats: [
        { cue: 'faziam de verdade', kind: 'question', text: 'O que faziam de verdade?' },
        { cue: 'Pesquisa sobre o sono', kind: 'list', title: 'ALGUMAS CATEGORIAS', items: ['DROGAS E ÁLCOOL', 'HIPNOSE', 'PESQUISA DO SONO', 'POLÍGRAFOS'] },
        { cue: 'nunca foram avisadas', kind: 'versus', left: 'VOLUNTÁRIOS', right: 'NUNCA AVISADOS', caption: 'Dois tipos bem diferentes de participante' },
      ],
    },
    cost: {
      title: 'O custo humano',
      narration:
        'Segundo o depoimento, seis subprojetos testaram drogas em pessoas desavisadas. Desavisadas quer dizer que elas não sabiam. Alguns desses testes aconteceram em casas seguras em São Francisco e Nova York. Não houve consentimento informado. Um caso mostra o que isso significava. O doutor Frank Olson era um funcionário civil do Exército. Em 1953, numa reunião convocada pela CIA, ele recebeu LSD sem saber. Cerca de uma semana depois, estava morto.',
      keywords: ['seis subprojetos', 'desavisadas', 'casas seguras', 'consentimento informado', 'Frank Olson'],
      beats: [
        { cue: 'seis subprojetos', kind: 'waffle', total: 149, hit: 6, label: '6 DE 149 SUBPROJETOS', note: 'testaram drogas em quem não sabia' },
        { cue: 'Desavisadas quer dizer', kind: 'define', word: 'de·sa·vi·sa·do', pos: 'adjetivo', meaning: 'que não sabe; sem consciência do que está acontecendo' },
        { cue: 'Não houve consentimento', kind: 'define', word: 'con·sen·ti·men·to in·for·ma·do', pos: 'substantivo', meaning: 'aceitar um experimento depois de saber o que ele envolve' },
      ],
    },
    revelation: {
      title: 'A revelação',
      narration:
        'Então, como tudo isso veio à tona? Em janeiro de 1975, o Senado criou um comitê especial, presidido pelo senador Frank Church. A missão dele era descobrir se as agências de inteligência dos Estados Unidos tinham feito algo ilegal, impróprio ou antiético. Depois, em 1977, um funcionário da CIA encontrou sete caixas de registros do MKUltra num centro de arquivos inativos. Naquele agosto, os senadores interrogaram o diretor da CIA numa audiência conjunta. O senador Edward Kennedy disse que a CIA tinha drogado cidadãos americanos sem o conhecimento nem o consentimento deles.',
      keywords: ['Frank Church', 'ilegal, impróprio ou antiético', 'sete caixas', 'audiência conjunta', 'Edward Kennedy'],
      beats: [
        { cue: 'veio à tona', kind: 'question', text: 'Como veio à tona?' },
        { cue: 'ilegal, impróprio ou antiético', kind: 'list', items: ['ILEGAL?', 'IMPRÓPRIO?', 'ANTIÉTICO?'] },
        {
          cue: 'O senador Edward Kennedy disse',
          kind: 'record',
          tag: 'SENADO DOS EUA · 3 AGO 1977',
          who: 'Sen. Edward Kennedy',
          text: 'A CIA drogou cidadãos americanos sem o conhecimento nem o consentimento deles.',
          highlight: 'sem o conhecimento nem o consentimento deles',
          note: 'Paráfrase do registro da audiência',
        },
      ],
    },
    known: {
      title: 'O que sabemos',
      narration:
        'Mas essas caixas nunca foram a história toda. Um relatório de 1963 do Inspetor-Geral da CIA levou ao fim dos testes em pessoas desavisadas em 1964. E em 1973, arquivos do MKUltra foram destruídos com a autorização do então diretor da CIA. O senador Kennedy disse o nome dele: Richard Helms. O que sobreviveu foram, principalmente, pastas financeiras. Adiantamentos, comprovantes, prestações de contas. Então, o que a gente sabe de verdade? O suficiente para mostrar que aconteceu. Não o suficiente para saber tudo o que aconteceu. Boa parte da história completa talvez nunca seja conhecida.',
      keywords: ['1963', '1964', '1973', 'destruídos', 'Richard Helms', 'pastas financeiras', 'nunca seja conhecida'],
      beats: [
        { cue: 'fim dos testes', kind: 'span', from: 'Relatório 1963', to: '1964', label: 'FIM DOS TESTES SEM AVISO' },
        { cue: 'Adiantamentos, comprovantes', kind: 'list', title: 'O QUE SOBREVIVEU', items: ['ADIANTAMENTOS', 'COMPROVANTES', 'PRESTAÇÕES DE CONTAS'] },
        { cue: 'O suficiente para mostrar', kind: 'statement', lines: ['O SUFICIENTE PARA MOSTRAR', 'QUE ACONTECEU.'] },
        { cue: 'Não o suficiente para saber', kind: 'statement', lines: ['NÃO O SUFICIENTE PARA SABER', 'TUDO O QUE ACONTECEU.'] },
      ],
    },
  },
  say: [
    ['MKUltra', 'eme cá ultra'],
    ['Church', 'Tchârtch'],
  ],
};

export const SCRIPTS: Record<Lang, LocalizedScript> = { en: english, it: italian, es: spanish, fr: french, pt: portuguese };

export const scriptFor = (lang: Lang | undefined): LocalizedScript => SCRIPTS[lang ?? 'en'] ?? english;

/** Apply the narrator's pronunciation hints (whole-word, case-sensitive). */
export function spokenText(text: string, lang: Lang): string {
  let out = text;
  for (const [written, spoken] of scriptFor(lang).say) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${written.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'gu'), spoken);
  }
  return out;
}
