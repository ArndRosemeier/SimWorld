/**
 * The phrase banks of the chatter engine (plan §4.2): what people say for each speech act, by register. Written at
 * authoring time (Arnd's decision: authoring-time LLM = Claude) and curated; shipped as static data.
 *
 * Region-neutral English (Arnd, 2026-10-18: an invented, western-adjacent world, nothing that identifies a region):
 * no "mom" or "mum", "vacation" or "holiday", "fall" or "autumn", "Alright?" or "y'all"; British spelling where a
 * word differs, but such words are avoided. `DIALECT_MARKED` (src/talk/voice.ts) is the gate the tests run.
 *
 * Banks come in adjacency pairs: every act that expects an answer has its answering acts, and a bank holds only
 * phrases that do the same job (a reaction bank has no questions in it, a statement bank no open questions), so
 * whatever is picked, the next line still answers it. src/talk/chatter.ts chooses which act follows which. Banks
 * are large so that, with the rotation in src/talk/grammar.ts (`pick`), a phrase does not come round again within a
 * listener's day.
 *
 * Registers: `any` is for everyone; `casual` or `formal` by the speaker's formality; `young` (teens and young
 * adults), `old` and `kid` by age. A speaker draws from `any` plus the registers that fit them, except children: a
 * bank with a `kid` register is all a child says from it (no "Oh, that's juicy" from a five-year-old).
 *
 * Slots (filled by src/talk/chatter.ts): {name} the listener's name, {tod}/{todl} "Morning"/"morning", {wow} an
 * exclamation by swearing level, {who} the story's subject (first name, when the listener knows them), {pro}/{Pro}
 * /{pro_obj}/{is} their pronoun and agreement, {src}/{src_o}/{src_pro} who told the speaker, {fact}/{Fact} a story
 * as a clause, {occ}/{Occ} an occasion, {when}/{When}, {lore} local knowledge, {kin} someone close to the listener,
 * {work} the listener's workplace, {ago} when the speaker heard it, {P} a place, {tie} a family word, {kid}/{Kid}.
 */
import type { AgeGroup, Voice } from './voice';

export type Register = 'any' | 'casual' | 'formal' | 'young' | 'old' | 'kid';
export type Bank = Partial<Record<Register, readonly string[]>>;

/** The phrases of `bank` that fit a voice. */
export function phrasesFor(bank: Bank, voice: Voice): readonly string[] {
  const g: AgeGroup = voice.group;
  if (g === 'child' && bank.kid) return bank.kid;
  const out: string[] = [...(bank.any ?? [])];
  const fit = (r: Register) => { const l = bank[r]; if (l) out.push(...l); };
  fit(voice.formality > 0.6 ? 'formal' : 'casual');
  if (g === 'teen' || g === 'young') fit('young');
  else if (g === 'old') fit('old');
  return out.length ? out : bank.casual ?? bank.formal ?? bank.kid ?? [];
}

export const ACTS = {
  // ---- greetings: a plain greeting gets a plain one back; "how are you?" gets an answer and the question back ----
  "greet.stranger": {
    any: ["Hello.", "{tod}.", "Hello there.", "Hi there.", "Hi.", "{tod}!", "Hello, {todl}."],
    casual: ["Hey.", "Hey there.", "Hi!"],
    formal: ["Good {todl}.", "Good {todl} to you.", "Hello, good {todl}."],
    young: ["Hey.", "Hi."],
    old: ["Good {todl}.", "Hello, dear.", "Good {todl}, dear."],
    kid: ["Hi!", "Hello!", "Hi."],
  },
  "greet.known": {
    any: ["{tod}, {name}.", "Hello, {name}.", "{name}! Hello.", "Oh, hello, {name}.", "Hi, {name}.", "There's {name}.", "Hello there, {name}.", "{name}, hi."],
    casual: ["Hey, {name}!", "Hey, {name}.", "There you are, {name}!", "Look who it is!", "Hey, you!", "{name}! Good to see you.", "{name}! Long time no see.", "Oh, hey, {name}."],
    formal: ["Good {todl}, {name}.", "{name}, how nice to see you.", "Ah, {name}. Good {todl}.", "Hello, {name}. Nice to see you."],
    young: ["Hey, {name}!", "Oh, hey, {name}.", "Hey, hey, {name}.", "{name}! Hi!"],
    old: ["Well, if it isn't {name}!", "{name}! How nice.", "Hello, {name}, dear.", "{name}, there you are."],
    kid: ["Hi, {name}!", "{name}! Hi!", "Hello, {name}!"],
  },
  "greet.how": {
    any: ["{tod}, {name}. How are you?", "Hello, {name}. How are you?", "{name}! How are things?", "How are you, {name}?", "Hi, {name}. How have you been?", "{name}! How are you doing?"],
    casual: ["{name}! How's it going?", "How's things, {name}?", "Hey, {name}, how's life?", "Hey, {name}. How are you doing?", "{name}! What's new?"],
    formal: ["Hello, {name}. How are you keeping?", "Good {todl}, {name}. How are you?", "Hello, {name}. Are you well?", "{name}, how are you today?"],
    young: ["Hey, {name}, how's it going?", "{name}! How are you?", "Hey, how are you doing?"],
    old: ["Hello, {name}. Keeping well?", "How are you keeping, {name}, dear?", "{name}! And how are you today?"],
    kid: ["Hi, {name}! How are you?"],
  },
  "greet.home": {
    any: ["Oh, there you are.", "You're back.", "Hello, you.", "Oh, it's you.", "Hi.", "There you are.", "Back already?"],
    casual: ["Hey.", "You're up, then.", "Hey, you."],
    young: ["Hey.", "Oh. Hi."],
    kid: ["Hi!", "You're back!", "Look, it's me!"],
  },
  "greet.again": {
    any: ["Hello again.", "Us again!", "We keep running into each other.", "Back again?", "Twice in one day!", "Hello again, {name}.", "Fancy meeting you twice."],
    old: ["Hello again, dear."], young: ["Hey again.", "Oh, hey again."], kid: ["Hi again!"],
  },
  "greet.reply": {
    any: ["Hello.", "{tod}.", "Hello there.", "Oh, hello!", "Hello, {name}.", "Hi.", "Hi, {name}.", "{tod}, {name}."],
    casual: ["Hey!", "Oh, hey!", "Hey, {name}.", "Hi there!"],
    formal: ["Good {todl}.", "Good {todl}, {name}.", "Hello, {name}."],
    young: ["Hey.", "Hi.", "Oh, hey, {name}."],
    old: ["Hello, dear.", "Hello, {name}, dear."],
    kid: ["Hi.", "Hi, {name}!", "Hello!"],
  },
  "greet.fine": {
    any: ["Fine, thanks. You?", "Not bad, thanks. And you?", "Very well, thanks. You?", "Good, thanks. How about you?", "Pretty good. You?", "Can't complain. And you?", "Doing fine, thanks. And yourself?", "Oh, not too bad. You?"],
    casual: ["Not bad, you?", "Surviving. You?", "Same old. You?", "Good, good. You?", "Getting there. You?"],
    formal: ["Very well, thank you. And you?", "Quite well, thank you. And yourself?"],
    young: ["Good, you?", "Yeah, good. You?", "Fine. You?"],
    old: ["Oh, still going. And you?", "Not so bad for my age. And you, dear?", "Still here! And you?"],
    kid: ["Good! You?", "Fine."],
  },
  "greet.fine.low": {
    any: ["Oh, I've been better. You?", "A bit tired, to be honest. You?", "Up and down. You?", "Hanging in there. You?"],
    casual: ["Don't ask. You?", "Worn out. You?"],
    old: ["Oh, my back. But there we are. You?"],
    kid: ["I'm tired."],
  },
  "greet.fine.back": {
    any: ["Good, thanks.", "Not bad.", "Fine, fine.", "Oh, you know. Getting by.", "Can't complain.", "Pretty good, thanks.", "All right, thanks.", "Busy, but good."],
    casual: ["Yeah, good.", "Same old.", "Not bad at all."],
    formal: ["Very well, thank you.", "Quite well."],
    young: ["Yeah, good.", "Fine."],
    old: ["Oh, still going!", "Getting by, dear."],
    kid: ["Good!"],
  },

  // ---- passing on news ------------------------------------------------------------------------------------------
  "news.open": {
    any: ["Have you heard?", "Did you hear?", "Have you heard the news?", "Did you know?", "Did anyone tell you?", "I don't know if you've heard.", "Did you hear about this?", "You might have heard already."],
    casual: ["Guess what.", "Get this.", "So, guess what.", "Have you heard the latest?", "Here's something."],
    formal: ["I don't know if you've heard.", "Did anyone tell you?", "I wonder if you've heard."],
    young: ["Okay, so.", "Wait, have you heard?", "Okay, listen."],
    old: ["Have you heard the latest?", "Now, did you hear?", "I don't know if anyone's told you."],
    kid: ["Guess what!", "Did you know?", "You know what?"],
  },
  // A second story after a light first one ("Oh, and…").
  "news.open.also": {
    any: ["Oh, and did you hear?", "That reminds me.", "Oh, and another thing.", "Oh, and you know what else?", "Something else, too."],
    casual: ["Oh, and get this.", "Oh! And guess what."],
    formal: ["There was something else, too.", "And I heard something else."],
    kid: ["And guess what!"],
  },
  // A second story after a heavy one: no cheery pivot.
  "news.open.also.heavy": {
    any: ["And that's not all.", "On top of that,", "There's something else, too.", "And I heard something else."],
    kid: ["And something else."],
  },
  // Good news after a heavy one.
  "news.open.brighter": {
    any: ["On a happier note,", "Some better news, though.", "At least there's some good news.", "Something nicer, though."],
    kid: ["But guess what!"],
  },
  "news.open.scandal": {
    any: ["You won't believe this.", "Wait till you hear this.", "Have you heard about {who}?", "Now this is between us.", "Did you hear what {who} did?"],
    casual: ["Oh my God, have you heard?", "You have to hear this.", "Get this.", "I've got gossip."],
    formal: ["I really shouldn't say, but…", "I don't like to gossip, but…", "This may surprise you."],
    young: ["Oh my God. Okay.", "Wait. Did you hear about {who}?", "Okay, the drama."],
    old: ["Well! You'll never believe it.", "I heard such a thing.", "Now, I'm not one to talk, but…"],
    kid: ["Guess what I heard!", "Did you know?"],
  },
  "news.open.crime": {
    any: ["Did you hear what happened?", "Have you heard?", "There was trouble, did you hear?", "Something awful happened, did you hear?", "I don't know if you've heard."],
    casual: ["Did you hear about this?", "Have you heard what happened?"],
    formal: ["I'm afraid there's been some trouble.", "There's been an unpleasant business."],
    old: ["Did you hear? It's shocking.", "You won't like this."],
    kid: ["Did you know?", "Guess what happened!"],
  },
  "news.open.sad": {
    any: ["I've got some sad news.", "Did you hear about {who}?", "I don't know if you've heard.", "It's sad news, I'm afraid.", "Have you heard? It's not good."],
    formal: ["I'm afraid there's sad news.", "I'm sorry to be the one to tell you."],
    old: ["Oh, have you heard? It's terrible.", "Such a shame, have you heard?"],
    kid: ["Something sad happened."],
  },
  "news.open.good": {
    any: ["Have you heard the good news?", "Some good news for once!", "Did you hear about {who}?", "Here's some nice news.", "Have you heard? It's good news.", "I heard something nice."],
    casual: ["Oh, you'll like this.", "Good news for a change."],
    old: ["Isn't it nice, have you heard?"],
    kid: ["Guess what!", "Did you know?"],
  },
  "news.open.self.small": { any: ["Did I tell you?", "Oh, did I say?", "Oh, I meant to say,", "By the way,", "I don't think I told you."], kid: ["Guess what!"] },
  "news.open.self": {
    any: ["Guess what?", "I've got news.", "I've got something to tell you.", "Did I tell you?", "I have some news, actually."],
    casual: ["So, guess what.", "Big news."],
    formal: ["I have some news, actually.", "I should tell you something."],
    young: ["Okay, big news.", "So, um. News."],
    kid: ["Guess what!", "I have news!"],
  },
  "news.open.secret": {
    any: ["Don't tell anyone, but…", "Keep this to yourself, but…", "Between you and me…", "This is just between us.", "You didn't hear this from me."],
    casual: ["Promise you won't tell?", "Don't say I said, but…", "Can you keep a secret?"],
    formal: ["I'd rather this went no further, but…", "In confidence…"],
    young: ["Okay, don't tell anyone.", "You can't tell anyone. Seriously."],
    old: ["Now, this mustn't go any further."],
    kid: ["It's a secret, okay?"],
  },

  // ---- hedges: how sure, and how they know ---------------------------------------------------------------------
  "hedge.witnessed": { any: ["I saw it myself.", "I was there.", "I saw it with my own eyes.", "I was right there.", "I saw the whole thing."], kid: ["I saw it!"] },
  "hedge.broadcast": { any: ["It was in the paper.", "It's in the paper.", "It's on the notice board.", "I read it in the paper.", "Someone put it on the notice board."] },
  "hedge.told": {
    any: ["{src} told me.", "I heard it from {src_o}.", "That's what {src} said.", "{src} was telling me.", "{src} mentioned it.", "I had it from {src_o}."],
    casual: ["Got it from {src_o}.", "{src} said so."],
    kid: ["{src} told me."],
  },
  "hedge.unsure.pre": { any: ["Apparently", "People are saying", "I heard", "Someone said", "They say", "From what I hear,", "Word is"], kid: ["Somebody said"] },
  "hedge.mid.pre": { any: ["Apparently", "I heard", "I hear", "It seems"], kid: ["Somebody said"] },
  "hedge.unsure.post": { any: ["Or so they say.", "Don't quote me.", "If it's true.", "That's what I heard, anyway.", "But who knows.", "I don't know how true it is."], kid: ["I think."] },
  // Only for a scandal told by a gossip.
  "tag.embellish": {
    any: ["And that's not even the half of it.", "And it's not the first time, from what I hear.", "Everyone's talking about it.", "And I'm not making that up."],
    casual: ["Can you believe it?"],
  },

  // ---- reactions: pure reactions, no questions. `.far`: about someone the listener does not know --------------------
  "react.tragic": {
    any: ["Oh no.", "Oh, that's awful.", "That's terrible.", "I'm so sorry to hear that.", "Oh, how sad.", "Oh. I didn't know.", "Oh, no. Poor {who}.", "That's so sad."],
    casual: ["Oh God, no.", "No… that's awful.", "Oh, that's horrible."],
    formal: ["How dreadful.", "I'm very sorry to hear it.", "That is sad news."],
    young: ["Oh no. That's so sad.", "Wait, seriously? That's awful."],
    old: ["Oh, the poor soul.", "Oh dear, oh dear.", "God rest {pro_obj}."],
    kid: ["Oh no.", "That's sad.", "That's really sad."],
  },
  "react.tragic.far": {
    any: ["Oh, that's sad.", "Oh, I'm sorry to hear that.", "That's a shame.", "Oh dear.", "How sad.", "That's too bad."],
    old: ["Oh, the poor family.", "That's sad. It comes to us all."],
    kid: ["Oh.", "That's sad."],
  },
  "react.sad": {
    any: ["Oh no, poor {who}.", "Oh dear.", "That's a shame.", "Poor thing.", "Oh, I hope {pro} {is} all right.", "That's hard.", "Oh, poor {who}."],
    casual: ["Ah, that's rough.", "Oh no. Poor {who}.", "That's awful."],
    formal: ["I'm sorry to hear that.", "That's very unfortunate.", "I do hope {pro} {is} all right."],
    old: ["Oh dear. Poor {who}.", "Oh, that's a shame. {Pro} {is} such a dear."],
    young: ["Aw, no.", "That's so bad."],
    kid: ["Oh no.", "Poor {who}."],
  },
  "react.sad.far": {
    any: ["Oh, that's a shame.", "Oh dear.", "Poor thing.", "That's too bad.", "Oh, I'm sorry to hear it.", "That's hard."],
    young: ["Aw, that's sad."],
    kid: ["Oh no."],
  },
  "react.bad": {
    any: ["Oh no.", "That's a shame.", "That's not good.", "Oh dear.", "What a shame.", "Poor {who}.", "That's hard luck."],
    casual: ["Ah, that's rough.", "Bad luck.", "{wow}. That's a blow."],
    formal: ["That's unfortunate.", "I'm sorry to hear it."],
    young: ["That's rough.", "Oof.", "Ugh, no."],
    old: ["Times are hard.", "Oh, that's a pity."],
    kid: ["Oh no.", "That's bad."],
  },
  "react.bad.far": {
    any: ["That's a shame.", "Oh, that's too bad.", "Oh dear.", "Hm. That's a pity.", "Not good.", "Shame, that."],
    young: ["Oof.", "That's rough."],
    kid: ["Oh."],
  },
  "react.good": {
    any: ["Oh, that's nice!", "Oh, how nice.", "That's wonderful.", "Good for {who}!", "Oh, I'm glad.", "That's great news.", "Oh, I'm so happy for {pro_obj}."],
    casual: ["Oh, great!", "Good for {pro_obj}!", "Oh, that's great.", "About time!"],
    formal: ["How wonderful.", "That is good news."],
    young: ["Aw, cute!", "No way, that's amazing!", "Love that.", "That's so nice."],
    old: ["Oh, how nice.", "Isn't that nice.", "Well, well. Good for {who}."],
    kid: ["Cool!", "Yay!", "Really? Cool!"],
  },
  "react.good.far": {
    any: ["Oh, nice.", "Good for {pro_obj}.", "That's nice.", "Oh, how nice.", "Well, good for them.", "Nice to hear."],
    young: ["Oh, cool.", "Nice."],
    kid: ["Cool."],
  },
  "react.good.grudging": {
    any: ["Huh. Good for {who}, I suppose.", "Well. Good luck to {pro_obj}.", "Lucky {who}.", "Hm. Some people have all the luck."],
    casual: ["Huh. Didn't see that coming.", "Right. Good for {pro_obj}."],
    kid: ["Oh."],
  },
  "react.scandal.gossip": {
    any: ["No!", "You're joking!", "I knew it!", "Never!", "Well, well, well.", "Who'd have thought it.", "Really? {who}?"],
    casual: ["{wow}!", "Shut up!", "No way!", "I knew there was something going on!"],
    formal: ["Good heavens.", "Goodness me!", "Well, I never."],
    young: ["No way!", "Oh my God.", "Stop it.", "That's wild."],
    old: ["Well, I never!", "Goodness gracious!"],
    kid: ["Whoa!", "Really?"],
  },
  "react.scandal.prim": {
    any: ["That's none of our business, really.", "Well, that's not very nice.", "I'd rather not know.", "People should mind their own business.", "That's their affair."],
    formal: ["I don't think we should be talking about this.", "That's hardly our concern."],
    old: ["Disgraceful.", "We didn't talk about such things when I was young."],
    kid: ["Oh."],
  },
  "react.crime": {
    any: ["That's awful.", "In this town!", "Shocking.", "That's horrible.", "That's frightening.", "Here? I can't believe it."],
    casual: ["{wow}. Here, of all places.", "That's scary.", "I'm locking my door tonight."],
    old: ["It was never like this before.", "What is the world coming to?"],
    young: ["That's so creepy.", "Here? That's crazy."],
    kid: ["That's scary.", "Whoa."],
  },
  "react.news": {
    any: ["Oh, really?", "Is that right?", "I didn't know that.", "Huh, I hadn't heard.", "Well, there you go.", "Oh, I see.", "Oh! I had no idea.", "Really? Well, well."],
    casual: ["Oh yeah?", "Huh. Interesting.", "No kidding."],
    formal: ["Is that so?", "How interesting.", "I hadn't heard."],
    young: ["Oh, okay.", "Huh, cool.", "Wait, really?"],
    old: ["Well, I never.", "Is that so?"],
    kid: ["Oh.", "Really?", "Huh."],
  },
  "react.politics": {
    any: ["About time.", "We'll see.", "Well, someone has to do it.", "That'll go down well.", "Hm. Interesting."],
    casual: ["Oh, great. Here we go.", "Typical.", "Can't be worse than the last ones."],
    formal: ["I'll be interested to see how that goes.", "That's worth keeping an eye on."],
    old: ["They're all the same.", "The council used to get things done."],
    kid: ["Oh."],
  },
  "react.event": {
    any: ["Oh, nice.", "Thanks for telling me.", "I'll write that down.", "Might go to that.", "Oh, good to know."],
    casual: ["Oh, cool.", "Might drop by."],
    kid: ["Cool!"],
  },
  "react.family.bad": {
    any: ["I know. It's been hard on all of us.", "Yes. We're all a bit shaken.", "I know. Please don't spread it around.", "Yes. It's my {tie}, you know."],
    casual: ["Yeah. Don't remind me.", "I know. It's rough."],
    kid: ["I know. It's my {tie}."],
  },
  "react.family.scandal": {
    any: ["That's my {tie} you're talking about!", "That's not true.", "You shouldn't listen to gossip.", "Leave my {tie} out of it."],
    casual: ["Hey. That's my {tie}.", "Watch it. That's family."],
    kid: ["That's my {tie}!"],
  },
  "family.scandal.back": { any: ["Sorry. I'm only saying what I heard.", "Sorry, I didn't mean anything by it.", "Oh. I didn't know. Sorry.", "Sorry. Forget I said it."] },
  "react.family.good": {
    any: ["I know! We're so pleased.", "Isn't it great? We're all thrilled.", "I know, we're very proud.", "Yes! My {tie}, can you believe it?"],
    kid: ["I know! It's my {tie}!"],
  },
  "react.knew": {
    any: ["I know, I heard.", "Yes, I'd heard.", "Old news, I'm afraid.", "So I hear.", "I know. Everyone's talking about it.", "Yes, someone told me."],
    casual: ["Yeah, I know.", "Heard that already."],
    kid: ["I know."],
  },
  "knew.back": { any: ["Ah, you'd heard.", "Word gets around, doesn't it?", "Nothing stays secret here.", "Of course you had."] },
  "react.self.good": { any: ["Congratulations!", "Oh, that's wonderful news!", "Well done, you!", "Oh, I'm so happy for you.", "That's great!", "Oh, congratulations, that's wonderful."], kid: ["Cool!", "Yay!"] },
  "react.self.bad": { any: ["Oh, I'm so sorry.", "That's awful. If there's anything I can do…", "I'm sorry. That must be hard.", "Oh no. I'm sorry."], kid: ["Oh no."] },
  "react.self.news": { any: ["Oh, really?", "Oh, how nice.", "Oh! I didn't know.", "Well, look at that.", "Oh, is that right?"], kid: ["Cool."] },
  "react.yours.good": { any: ["Oh, that's nice!", "How nice for your family!", "Oh, that's wonderful.", "Good for {pro_obj}!", "Oh, how nice for {pro_obj}."], kid: ["Cool!"] },
  "react.yours.bad": { any: ["Oh, I'm so sorry. Give {who} my best.", "Oh no. How are you all holding up?", "I'm so sorry to hear that.", "That must be hard for you all."], kid: ["Oh no. I'm sorry."] },
  "react.yours.scandal": { any: ["Oh no. What happened?", "Goodness, what was that about?", "Oh dear. Is everyone all right?", "Oh no. What a business."], kid: ["Oh no."] },
  "react.yours.scandal.answer": { any: ["Don't ask.", "I'd rather not talk about it.", "Nobody really knows.", "It's all a bit of a mess.", "We're sorting it out."] },
  "react.self.knew": { any: ["Yes, I heard! Congratulations.", "So I heard!", "I know, someone told me.", "Yes, I heard. That's great."] },
  "react.yours.answer": { any: ["We're managing, thanks.", "Getting there, thanks.", "Day by day.", "Oh, you know. We'll be all right.", "As well as can be."] },
  "react.self.close": { any: ["Thanks.", "Thank you.", "Thanks, that's kind.", "Thanks. We're pleased."] },
  // After a bad story about the teller's own: a goodbye that fits ("If you need anything…").
  "part.comfort": { any: ["If you need anything, just ask.", "Take care of yourself, okay?", "Look after yourself.", "I'll be thinking of you.", "You know where I am if you need me."], kid: ["Bye."] },
  "segue": { any: ["Anyway,", "Anyway.", "Oh, by the way,"], casual: ["Anyway,"], kid: ["Anyway,"] },

  // ---- doubt and where it came from ----------------------------------------------------------------------------
  "doubt": {
    any: ["I'm not sure about that.", "Hm. I'll believe it when I see it.", "That doesn't sound right.", "I doubt it.", "Really? I find that hard to believe."],
    casual: ["Come on.", "Yeah, right.", "No way. Can't be."],
    formal: ["I find that hard to believe.", "I'd want to hear that from someone else."],
    young: ["Yeah, sure.", "Is that even true?"],
    old: ["People will say anything these days.", "I'll believe it when I see it."],
    kid: ["That's not true.", "Nuh-uh."],
  },
  "doubt.who": { any: ["That doesn't sound like {who}.", "{who}? Never.", "Not {who}. I don't believe it."] },
  "defend.witnessed": { any: ["It's true! I saw it myself.", "I was there, I'm telling you.", "I saw it with my own eyes."], kid: ["It's true! I saw it!"] },
  "defend.told": { any: ["{src} told me, and {src_pro} should know.", "It's true, {src} said so.", "Ask {src_o} yourself.", "{src} wouldn't make it up."], kid: ["{src} said so!"] },
  "defend.vague": { any: ["Well, that's what everyone's saying.", "Suit yourself. That's what I heard.", "Believe what you like.", "That's what's going around."], kid: ["It's true!"] },
  "doubt.close": { any: ["Hm. If you say so.", "We'll see.", "Well, maybe.", "I'll wait and see.", "If you say so."], kid: ["Okay."] },
  // "Who told you?" is answered with who; "Where did you hear that?" with where it came from.
  "ask.source.who": { any: ["Who told you that?", "Who said?", "Who told you?", "Says who?"], kid: ["Who said?"] },
  "ask.source.where": { any: ["Where did you hear that?", "Where's that from?", "How do you know?", "Where did you get that?"], kid: ["How do you know?"] },
  "answer.source.who": { any: ["{src} did.", "{src} told me.", "It was {src_o}, actually.", "{src}. {src_pro} was telling me {todl}."], casual: ["{src} did. Don't tell {src_them} I said."], kid: ["{src} did."] },
  "answer.source.where": { any: ["From {src_o}.", "{src} told me.", "I heard it from {src_o}.", "{src} mentioned it.", "{src} was telling me about it."], kid: ["{src} told me."] },
  "answer.source.vague": { any: ["Oh, people are talking.", "Just something I heard.", "Everyone's saying it.", "I can't remember now.", "It's going around."], kid: ["Somebody said."] },
  "answer.source.self": { any: ["{Pro} told me {self}.", "From {pro_obj} directly: {pro} told me {self}.", "{Pro} said so {self}."] },
  "answer.witnessed": { any: ["I saw it myself.", "I was there!", "With my own eyes."], kid: ["I saw it!"] },
  "source.trusted": { any: ["Oh, well, if {src} says so.", "Then it must be true.", "{src} would know.", "Ah. Then I believe it."] },
  "source.doubted": { any: ["{src}? I'd be careful with that one.", "Oh, {src} says all sorts.", "Hm. Consider the source.", "{src}? Well, maybe."] },
  "source.neutral": { any: ["Oh, right.", "I see.", "Ah, okay.", "Right.", "Oh, okay."], kid: ["Oh."] },
  "source.vague.back": { any: ["Hm. Well, people say all sorts.", "Right. We'll see.", "Hm. Maybe."] },

  // ---- two versions of a story -----------------------------------------------------------------------------------
  "correct": {
    any: ["That's not what I heard. I heard {fact}.", "No, I heard {fact}.", "Really? The way I heard it, {fact}.", "Hang on, I heard {fact}.", "That's not how I heard it. {Fact}, I was told."],
    formal: ["I believe you're mistaken. I was told {fact}.", "I heard something rather different: {fact}."],
  },
  "correct.src": { any: ["Funny, {src} told me {fact}.", "Hang on, {src} told me {fact}."] },
  "correct.worse": { any: ["Oh, it's worse than that, I heard.", "Worse, from what I heard.", "That's putting it mildly, from what I heard.", "I heard it was a lot worse."] },
  "correct.milder": { any: ["Hm, I heard it wasn't that bad.", "I think that's been blown up a bit.", "People do exaggerate. It wasn't that bad, I heard.", "Not as bad as all that, from what I heard."] },
  "insist.witnessed": { any: ["No, I saw it myself.", "I was there. I know what I saw.", "I'm sure of it, I saw it."] },
  "insist.told": { any: ["Well, {src} was sure.", "That's what {src} told me, and {src_pro} should know.", "I'm only saying what {src} said."] },
  "concede": { any: ["Oh. Maybe I've got it wrong.", "Could be. I only heard it secondhand.", "Well, you may be right.", "Huh. Then someone's got it muddled.", "Maybe. Who knows, with this town."] },
  "worse.back": { any: ["Is it? I hadn't heard that.", "Oh no, really?", "Worse? Oh dear.", "Goodness. I only heard half of it, then."] },
  "milder.back": { any: ["Well, that's how it was told to me.", "Maybe. People do exaggerate.", "Oh, good. I hope you're right.", "Could be. You know how stories grow."] },
  "differ.close": { any: ["Well, we'll find out.", "Time will tell.", "One of us is wrong, then.", "We'll see who's right."] },
  "concede.close": { any: ["Easy mistake.", "That's how stories go.", "Ah well.", "Could be either, I suppose."] },

  // ---- after the reaction: a detail, a question ----------------------------------------------------------------
  "detail.heard": { any: ["I only heard {ago}.", "I just found out {ago}.", "I heard it {ago}.", "Only found out {ago}, myself."] },
  "detail.place": { any: ["At {P}, of all places.", "Right there at {P}.", "It was at {P}, apparently.", "At {P}, too."] },
  "detail.ack": { any: ["Goodness.", "Really.", "Hm.", "Well, well.", "Is that right."], kid: ["Whoa."] },
  "ask.funeral": { any: ["When's the funeral?", "Do you know when the funeral is?", "Is there a funeral yet?"] },
  "ask.wedding": { any: ["When's the wedding?", "Have they set a date?", "Do you know when the wedding is?"], kid: ["Is there going to be a wedding?"] },
  "ask.jobless": { any: ["What will {pro} do now?", "How's {pro} taking it?", "Has {pro} got anything else lined up?"] },
  "ask.ill": { any: ["How bad is it?", "Do they know what it is?", "Is {pro} at home?"], kid: ["Is {pro} going to be okay?"] },
  "ask.baby": { any: ["Boy or girl?", "Do you know if it's a boy or a girl?"], kid: ["Is it a boy or a girl?"] },
  "answer.when": { any: ["{When}, I think.", "{When}. At {P}.", "It's {when}, I heard.", "{When}, at {P}, I think."] },
  "answer.dunno": { any: ["I don't know yet.", "No idea.", "Nobody's said.", "I don't know, to be honest.", "Couldn't tell you."], kid: ["I don't know."] },
  "answer.dunno.close": { any: ["Let me know if you hear.", "Well, keep me posted.", "I'll find out."] },
  "answer.when.close": { any: ["I'll be there.", "I'll try to go.", "Thanks. I'll make a note.", "Okay. I'll be there if I can."] },
  "answer.kid": { any: ["A little {kid}.", "A {kid}, I heard.", "{Kid}! Isn't that nice?"], kid: ["A {kid}!"] },
  "answer.kid.close": { any: ["Oh, how sweet.", "Aw.", "How nice.", "Oh, that's nice."], kid: ["Cool."] },
  "secret.close": { any: ["Don't tell anyone I told you.", "Keep it to yourself.", "Not a word, okay?", "You didn't hear it from me."], kid: ["Don't tell!"] },
  "secret.reply": { any: ["My lips are sealed.", "I won't say a word.", "Of course.", "Who would I tell?"], kid: ["I won't."] },

  // ---- small talk: openers are statements or tag questions; replies agree ------------------------------------------
  "weather.rain": {
    any: ["Awful weather.", "It's not stopping, is it?", "Raining again.", "Wet out there.", "Another wet one.", "Look at this rain.", "It's really coming down.", "Miserable out, isn't it?"],
    casual: ["It's pouring, isn't it?", "Rain again. Typical.", "I'm soaked."],
    old: ["My knees knew it would rain.", "Good for the gardens, I suppose."],
    young: ["Ugh, this rain.", "I'm drenched."],
    kid: ["It's raining!", "I got wet!", "Can we jump in puddles?"],
  },
  "weather.drizzle": { any: ["A bit drizzly.", "This drizzle gets everywhere.", "Can't decide if it's raining or not.", "Damp sort of day.", "Light rain again."], kid: ["It's a bit rainy."] },
  "weather.storm": { any: ["What a storm!", "Wild out there.", "Best stay in today.", "The lights flickered at ours.", "That thunder!", "Some storm, this."], kid: ["The thunder's so loud!", "I don't like storms."] },
  "weather.snow": {
    any: ["Look at all this snow!", "Snow again.", "Careful, it's slippery.", "Real winter, this.", "It's really coming down.", "The snow's stayed, then."],
    kid: ["It's snowing!", "I want to build a snowman!", "Can we play in the snow?"],
    old: ["Careful on the ice, at our age.", "Winters were worse when I was young."],
    young: ["So much snow!", "Snow day, surely."],
  },
  "weather.ice": { any: ["Watch out for the ice.", "It's like a skating rink out there.", "Nearly slipped on the path.", "Slippery underfoot today."], kid: ["I slid on the ice!"] },
  "weather.cold": {
    any: ["Cold today.", "Bitter out, isn't it?", "Freezing, isn't it?", "There's a nip in the air.", "Chilly one.", "Cold enough for you?"],
    casual: ["It's freezing out there.", "I can't feel my fingers."],
    old: ["It goes right through you.", "This cold gets into my bones."],
    kid: ["It's so cold!", "My hands are cold."],
  },
  "weather.hot": {
    any: ["Isn't it hot?", "What a scorcher.", "Too hot for me.", "Hot one today.", "Sticky out, isn't it?", "Warm enough for you?"],
    casual: ["I'm melting.", "Boiling, isn't it?"],
    young: ["It's so hot.", "Ice cream weather!"],
    kid: ["It's so hot!", "I want to go swimming!", "Can we have ice cream?"],
  },
  "weather.nice": {
    any: ["Nice day, isn't it?", "Beautiful day.", "Gorgeous out.", "Nice to see the sun.", "What a day.", "Isn't it a nice {todl}?", "Lovely day, isn't it?", "Sun's out, at last."],
    casual: ["Great day, huh?", "Gorgeous out, isn't it?"],
    old: ["A nice day for it.", "You can't beat a day like this."],
    kid: ["It's sunny!", "Can we go to the park?"],
  },
  "weather.fog": { any: ["Foggy this {todl}.", "Can hardly see across the road.", "Thick fog today.", "This fog!"], kid: ["It's all foggy!"] },
  "weather.grey": { any: ["Not much sun today.", "Dull, isn't it?", "Gloomy out.", "Could do with some sun.", "Not much of a day.", "Gloomy, isn't it?", "Overcast today."], kid: ["Where's the sun?"] },
  "weather.windy": { any: ["Windy, isn't it?", "Nearly blew away.", "Blowing hard out there.", "Hold on to your hat."], kid: ["It's so windy!"] },
  "weather.mild": {
    any: ["Not a bad day.", "Not bad out, is it?", "Pleasant enough today.", "Nice enough day.", "Decent day.", "Not too bad out there.",
      "[Fairly|Quite] mild today.", "A bit of sun, at least.", "Nice {todl}, isn't it?", "Dry, at least.", "Could be worse out.", "Calm today, isn't it?",
      "Not a bad {todl}.", "Can't complain about the weather today.", "Nice and mild.", "Quite pleasant out, isn't it?"],
    old: ["Kind weather today.", "Not a bad old day."],
    young: ["Nice out, kind of.", "Weather's okay today."],
    kid: ["It's nice out.", "Can we play outside?"],
  },
  "weather.reply.bad": {
    any: ["Isn't it.", "I know.", "Tell me about it.", "You're not wrong.", "Horrible, isn't it?", "Don't I know it."],
    casual: ["Yeah, I know.", "Don't get me started.", "Grim."],
    formal: ["Quite.", "Indeed it is.", "Dreadful."],
    old: ["It is, it is.", "Never seen the like."],
    kid: ["Yeah.", "I know!"],
  },
  "weather.reply.nice": {
    any: ["Isn't it.", "Nice, isn't it?", "Makes a change.", "Long may it last.", "Not bad at all.", "I'll take it.", "It is, isn't it?", "Better than rain.",
      "Can't ask for more.", "Mm, nice enough.", "Not complaining.", "Suits me."],
    casual: ["Can't complain.", "Yeah, nice."],
    formal: ["Very pleasant.", "It is indeed."],
    old: ["Good weather for it.", "Good for the garden."],
    kid: ["Yeah!", "Yeah, it's nice."],
  },
  "weather.reply.bright": { any: ["Still, it'll pass.", "Good for the gardens, though.", "Better than last week, though.", "Ah, could be worse."] },
  "weather.more.bad": { any: ["Supposed to go on all week.", "And they said it would clear up.", "I've had enough of it.", "Won't let up, will it?"] },
  "weather.more.nice": { any: ["Make the most of it, I say.", "Won't last, though.", "Supposed to stay like this all week.", "I'm going to sit in the garden later."] },
  "weather.more.ack": { any: ["Mm.", "Typical.", "We'll see.", "Fingers crossed.", "Let's hope."] },
  "occasion.ask": {
    any: ["Are you going to {occ} {when}?", "Going to {occ} {when}?", "Will we see you at {occ} {when}?", "You coming to {occ} {when}?"],
    formal: ["Will you be at {occ} {when}?"],
    kid: ["Are you going to {occ}?"],
  },
  "occasion.say": { any: ["{Occ} is {when}, isn't it?", "Don't forget {occ} {when}.", "It's {occ} {when}.", "Big day {when}: {occ}."] },
  "occasion.say.reply": { any: ["Oh, is it?", "Thanks for reminding me.", "I know, I can't wait.", "Already on my calendar.", "Oh, I'd forgotten.", "So it is."], kid: ["Yay!"] },
  "occasion.yes": { any: ["Wouldn't miss it.", "Yes, I'll be there.", "I think so.", "Of course.", "If I can get away."], kid: ["Yes!", "I think so."] },
  "occasion.no": { any: ["Not this time.", "Can't, I'm afraid.", "Probably not.", "Not really my thing.", "I'll see how I feel."], kid: ["I don't know."] },
  "occasion.yes.back": { any: ["See you there, then.", "Good, see you there.", "Great, save me a seat.", "Good."] },
  "occasion.no.back": { any: ["Shame.", "Oh, come on, it'll be fun.", "Fair enough.", "Another time, then."] },
  "occasion.sad": { any: ["Are you going to {occ} {when}?", "I suppose you'll be at {occ} {when}."] },
  "occasion.sad.reply": { any: ["Yes. I want to pay my respects.", "I will. Such a shame.", "Yes. It'll be a sad day.", "I think so."] },
  "holiday.christmas": { any: ["Merry Christmas!", "Merry Christmas to you and yours.", "Have a good Christmas!"], kid: ["Merry Christmas!", "I got presents!"] },
  "holiday.christmasEve": { any: ["All ready for tomorrow?", "Got all your presents?", "Nearly Christmas!"], kid: ["Is it Christmas yet?", "Santa comes tonight!"] },
  "holiday.newYear": { any: ["Happy New Year!", "All the best for the new year!"] },
  "holiday.newYearsEve": { any: ["Last day of the year!", "Going to see the fireworks?", "Doing anything tonight?"], kid: ["Can I stay up for the fireworks?"] },
  "holiday.easter": { any: ["Happy Easter!", "Nice Easter weekend."], kid: ["I found five eggs!", "Happy Easter!"] },
  "holiday.halloween": { any: ["Got your treats in for tonight?", "Ready for the trick-or-treaters?"], kid: ["Trick or treat!", "I'm going as a ghost!"] },
  "holiday.summerFestival": { any: ["Going to the festival?", "The festival's on!", "Have you been down to the festival yet?"], kid: ["Are you going to the festival?"] },
  "holiday.christmasMarket": { any: ["Been to the Christmas market yet?", "The Christmas market's on.", "Smell that mulled wine."], kid: ["Have you been to the Christmas market?"] },
  "holiday.reply.greeting": { any: ["And to you!", "You too!", "Same to you!", "Thank you, and you."], kid: ["You too!"] },
  "holiday.reply.question": { any: ["Yes, I think so.", "Not yet, but I will.", "Oh, I'm all set.", "Haven't had a minute.", "Wouldn't miss it."], kid: ["Yes!"] },
  "holiday.reply.statement": { any: ["Isn't it nice?", "I know!", "It's the best time of year.", "Nice, isn't it?"], kid: ["Yeah!"] },
  "lore": {
    any: ["You know, {lore}.", "Funny thing, {lore}.", "Someone told me {lore}.", "Here's a thing: {lore}.", "They say {lore}."],
    old: ["When I was young, they used to say {lore}.", "My father used to say {lore}."],
    young: ["Apparently {lore}.", "Fun fact: {lore}."],
    kid: ["Did you know {lore}?"],
  },
  "lore.reply.known": { any: ["Everyone knows that!", "Yes, so they say.", "I've heard that.", "That's true enough.", "So I've heard."] },
  "lore.reply.new": { any: ["Is that right?", "I didn't know that.", "Huh, really?", "You learn something every day.", "Well, there you go."] },
  "tired": {
    any: ["I'm worn out.", "Long day.", "I could sleep for a week.", "I'm dead on my feet.", "I'm so tired today."],
    casual: ["I'm exhausted.", "I'm beat."],
    young: ["So tired.", "Need sleep."],
    old: ["These old bones need a rest."],
    kid: ["I'm tired.", "I'm sleepy."],
  },
  "tired.reply": { any: ["Get an early night.", "Me too.", "Go home and put your feet up.", "You look it.", "I know the feeling."], kid: ["Me too."] },
  "hungry": { any: ["I'm starving.", "Could eat a horse.", "I haven't eaten all day.", "My stomach's rumbling."], kid: ["I'm hungry!", "I want a snack."] },
  "hungry.reply": { any: ["Me too.", "Go and get something.", "You should eat something.", "Same here, now you mention it."], kid: ["Me too!"] },
  "work.ask": { any: ["Busy at {work}?", "How's work?", "Keeping busy?", "How are things at {work}?", "How's {work} treating you?"] },
  "work.reply": {
    any: ["Never stops.", "Busy, busy.", "Quiet, actually.", "Can't complain.", "Same as ever.", "Crazy. Don't ask.", "Could be worse."],
    casual: ["Don't talk to me about work.", "It pays the bills."],
    young: ["It's fine. Boring.", "Ugh. Don't ask."],
  },
  "work.back": { any: ["I know the feeling.", "Ha. Same here.", "Rather you than me.", "Hang in there."] },
  "school.ask": { any: ["How's school?", "How's school going?", "School okay?", "How are you getting on at school?"] },
  "school.reply": { any: ["Fine.", "Boring.", "Okay.", "We had a test.", "It's okay."], young: ["Ugh. Fine.", "Don't ask."], kid: ["Fine.", "We did painting!", "Good."] },
  "school.back": { any: ["Good. Keep at it.", "Ha. I remember that.", "Best years of your life, you know.", "Well, stick with it."] },
  "family.ask": { any: ["How's {kin}?", "How's {kin} doing?", "And how's {kin}?", "Is {kin} keeping well?"], kid: ["Where's {kin}?"] },
  "family.reply": {
    any: ["{Pro} {is} fine, thanks.", "{Pro} {is} doing well.", "Oh, you know. Up and down.", "Same as ever.", "Very well, thank you.", "Keeping busy."],
    casual: ["Yeah, good, thanks.", "Still going strong!"],
    kid: ["{Pro} {is} at home."],
  },
  "family.reply.ill": { any: ["Not so good, to be honest.", "{Pro} {is} not well, actually.", "We're worried, to be honest."], kid: ["{Pro} {is} sick."] },
  "family.back": { any: ["Glad to hear it.", "Give {pro_obj} my love.", "Say hello from me.", "Good, good."], kid: ["Okay."] },
  "family.back.ill": { any: ["Oh, I'm sorry. Send my best.", "Oh no. Give {pro_obj} my love.", "I'll keep {pro_obj} in my thoughts.", "If there's anything I can do…"], kid: ["Oh no."] },
  "mood.low": {
    any: ["Not a great day, to be honest.", "A bit down today.", "One of those days."],
    young: ["Ugh, today.", "I'm so done with today."],
    old: ["Not one of my better days."],
    kid: ["I'm sad today."],
  },
  "mood.low.reply": { any: ["Oh no. Chin up.", "It'll get better.", "Sorry to hear that.", "Hang in there."], kid: ["Oh."] },
  "mood.low.cold": { any: ["Hm.", "We all have those.", "Oh well.", "It happens."] },
  "mood.high": { any: ["I'm in a good mood today.", "Feeling good today.", "Everything's going right for once."], kid: ["I'm happy today!"] },
  "mood.high.reply": { any: ["Good for you!", "Glad to hear it.", "Long may it last.", "Nice, I like to hear that."], kid: ["Me too!"] },

  // ---- what the other one is up to ----------------------------------------------------------------------------
  "doing.shop": { any: ["Doing some shopping?", "Stocking up for the week?", "Stocking up?"], kid: ["Are you shopping?"] },
  "doing.shop.reply": { any: ["Just a few things.", "Only the essentials.", "Never-ending, isn't it?", "Someone has to."], kid: ["We need milk."] },
  "doing.walkDog": { any: ["Out with the dog?", "Taking the dog out?", "Walking the dog?"], kid: ["Can I pet your dog?"] },
  "doing.walkDog.reply": { any: ["Yes, needs the exercise.", "Whatever the weather.", "Morning and night.", "Somebody's got to."] },
  "doing.exercise": { any: ["Out for a run?", "Keeping fit?", "Look at you, all sporty."] },
  "doing.exercise.reply": { any: ["Trying to.", "Have to keep moving.", "Don't let the face fool you, I'm dying.", "Doctor's orders."] },
  "doing.errand": { any: ["Running errands?", "Busy day?", "Off somewhere?"] },
  "doing.errand.reply": { any: ["Just a few jobs.", "Never stops.", "Post office, then the bank.", "Just heading out."], kid: ["I'm helping."] },
  "doing.eat": { any: ["Having a bite to eat?", "Grabbing something to eat?", "Treating yourself?"] },
  "doing.eat.reply": { any: ["Couldn't face cooking.", "Just a quick one.", "Why not.", "I'd earned it."], kid: ["Yes!"] },
  "doing.doctor": { any: ["Everything all right?", "Nothing serious, I hope?"] },
  "doing.doctor.reply": { any: ["Just a check-up.", "Oh, nothing much.", "Routine stuff.", "Just a prescription."], kid: ["Just a check-up."] },
  "doing.travel": { any: ["Where are you off to?", "Off somewhere nice?", "In a hurry?"] },
  "doing.travel.reply": { any: ["Just into town.", "Only around the corner.", "Running late, as usual.", "Home, finally."], kid: ["Home."] },
  "doing.worship": { any: ["Off to church?", "Nice service?"] },
  "doing.worship.reply": { any: ["Every week.", "Wouldn't miss it.", "It was nice, actually."], kid: ["Yes."] },
  "doing.leisure": { any: ["Taking it easy?", "Day off?", "Enjoying yourself?"] },
  "doing.leisure.reply": { any: ["Trying to.", "First time in ages.", "Making the most of it.", "Somebody has to."], kid: ["Yes!"] },

  // ---- the time of year and the weekend -------------------------------------------------------------------------
  "season.winter": { any: ["Dark so early now.", "These dark mornings.", "Frost on the cars again."], kid: ["When's it going to snow?"] },
  "season.spring": { any: ["Evenings are getting lighter.", "Everything's coming up green.", "Feels like spring at last.", "The birds are back."], kid: ["There are flowers out!"] },
  "season.summer": { any: ["Long evenings, aren't they?", "Summer's flying by.", "Nice light evenings."], kid: ["I love summer!"] },
  "season.autumn": { any: ["The leaves are turning.", "The days are getting shorter.", "Getting colder in the mornings.", "Leaves everywhere this time of year."], kid: ["Look at all the leaves!"] },
  "season.reply": { any: ["Isn't it.", "Where does the time go?", "Every year it surprises me.", "I know.", "Mm, it is."], kid: ["Yeah."] },
  "weekend.ask": { any: ["Doing anything this weekend?", "Any plans for the weekend?", "Got the weekend off?"] },
  "weekend.reply": { any: ["Not much. Some gardening.", "Seeing the family.", "Putting my feet up.", "Haven't thought that far.", "Cleaning the house."], kid: ["Playing!"] },
  "weekend.back": { any: ["Sounds nice.", "Lucky you.", "Enjoy it.", "Fair enough."] },

  // A remark about the place they are in: something nice ("good") or a moan, and a reply that fits either kind.
  "place.pub.good": { any: ["Quiet in here tonight.", "Good place, this.", "Nice to sit down after a day like this.", "Nice and quiet in here."] },
  "place.cafe.good": { any: ["The coffee's good here.", "The cake here is great.", "Nice and warm in here.", "Best coffee in town, this."] },
  "place.bakery.good": { any: ["Smells great in here.", "Nothing beats fresh bread.", "Their rolls are the best."], kid: ["It smells yummy!"] },
  "place.bakery.moan": { any: ["They've sold out of rolls again.", "Long wait today.", "Always busy in here."] },
  "place.shop.moan": { any: ["Prices keep going up.", "They've moved everything again.", "Busy today.", "Half the shelves are empty."] },
  "place.church.good": { any: ["Nice service.", "Good turnout today.", "Lovely hymns.", "Good sermon today."] },
  "place.park.good": { any: ["Nice spot, this.", "Nice for a walk.", "Look at the ducks.", "I could sit here all day."], kid: ["Look at the ducks!", "Can I go on the swings?"] },
  "place.school.moan": { any: ["Big test this week.", "Too much homework.", "So much homework."], kid: ["I don't like spelling tests."] },
  "place.doctor.moan": { any: ["Always a wait in here.", "Been waiting ages.", "Full in here today."] },
  "place.reply.good": { any: ["Mm.", "Can't beat it.", "That it is.", "Mm, I know."], casual: ["Can't argue with that."], kid: ["Yeah!"] },
  "place.reply.moan": { any: ["Tell me about it.", "Always the way.", "I know.", "You're telling me.", "Typical."], young: ["Ugh, I know."], kid: ["Yeah."] },

  // ---- endings, by mood ---------------------------------------------------------------------------------------------
  "part": {
    any: ["See you.", "Take care.", "Bye, then.", "See you later.", "I'd better get going.", "Okay, I'm off.", "See you around.", "Have a good {todl}.", "Bye for now.", "I'll let you get on.", "Nice seeing you.", "Catch you later."],
    casual: ["See you!", "Later!", "I'm off. See you."],
    formal: ["Good {todl} to you.", "Do take care.", "Nice to see you."],
    young: ["See you!", "Bye!", "Later."],
    old: ["Look after yourself.", "Don't be a stranger.", "Nice to see you, dear."],
    kid: ["Bye!", "See you tomorrow!", "Bye-bye!"],
  },
  // After sad news: gentle, never breezy.
  "part.sad": {
    any: ["Take care of yourself.", "Well. Take care.", "I'll let you go. Take care.", "Look after yourself.", "Give my best to the family."],
    kid: ["Bye."],
  },
  // After an argument or doubt: short.
  "part.tense": { any: ["Anyway.", "Well. See you.", "Right. I'll see you.", "Anyway, I'd better go.", "Well, I'll let you get on."], kid: ["Bye."] },
  // After a break-in or the like.
  "part.crime": { any: ["Lock your doors, then.", "Stay safe.", "Be careful out there.", "Be careful.", "Keep your door locked."], kid: ["Bye."] },
  "part.night": { any: ["Night.", "Goodnight.", "Sleep well.", "Night, then."], kid: ["Night-night!"] },
  "part.reply": { any: ["Bye.", "See you.", "Bye now.", "See you around.", "Bye, then."], young: ["Bye.", "Later."], kid: ["Bye!"] },
  "part.reply.sad": { any: ["Thanks. Bye.", "Bye.", "Thanks. See you.", "Bye, then."], kid: ["Bye."] },
  "snub": { any: ["Sorry, I have to go.", "Can't stop.", "Not now.", "I'm in a hurry.", "Excuse me."], casual: ["Got to go.", "Not today."], kid: ["I have to go."] },
  "snub.reply": { any: ["Charming.", "Well!", "Suit yourself.", "Fine.", "What did I do?"], kid: ["Okay."] },
  // ---- a word to a baby or toddler ----------------------------------------------------------------------------
  "little": { any: ["Hello, little one!", "Aren't you a sweetie?", "Look at you!", "Hello, {name}! Hello!", "Who's this, then?"], kid: ["Hi, baby!", "Can I hold {name}?"] },
  "little.own": { any: ["Come here, {name}.", "Who's a sleepy {boy}?", "Careful, {name}.", "Let's get you a snack.", "Not in your mouth, {name}!", "Up you come."], kid: ["Look, {name}, look!", "Come on, {name}."] },
  "animal.own.dog": { any: ["Good {boy}!", "Who's a good {boy}?", "Come on, {pet}!", "Leave it, {pet}.", "Heel, {pet}.", "Walk time!", "Sit, {pet}. Good."], kid: ["Come on, {pet}!", "Good {boy}!"] },
  "animal.own.cat": { any: ["Hello, {pet}.", "There you are, {pet}.", "Are you hungry, {pet}?", "Off the table, {pet}!", "Who's purring?"], kid: ["Hi, {pet}!"] },
  "animal.dog": { any: ["Hello, {boy}.", "Aren't you a nice one?", "Hello there, doggy.", "Good dog.", "Who's this, then?"], kid: ["Doggy!", "Can I pet {it}?"] },
  "animal.cat": { any: ["Hello, kitty.", "Here, kitty.", "Aren't you pretty?", "Psst, kitty kitty."], kid: ["Kitty!"] },
  "animal.farm": { any: ["Come on, then.", "Steady.", "There you go.", "Easy, now.", "Hup, hup!"] },
  "animal.wild": { any: ["Oh, look!", "Look, a {species}!", "Shh, you'll scare it.", "Well, hello there."] },
} as const satisfies Record<string, Bank>;

export type ActName = keyof typeof ACTS;
