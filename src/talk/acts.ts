/**
 * The phrase banks of the chatter engine (plan §4.2): what people say for each speech act, by register. Written at
 * authoring time (Arnd's decision: authoring-time LLM = Claude) and curated; shipped as static data.
 *
 * Banks come in adjacency pairs: every act that expects an answer has its answering acts, and a bank holds only
 * phrases that do the same job (a reaction bank has no questions in it, a statement bank no open questions), so
 * whatever is picked, the next line still answers it. src/talk/chatter.ts chooses which act follows which.
 *
 * Registers: `any` is for everyone; `casual` or `formal` by the speaker's formality; `young` (teens and young
 * adults), `old` and `kid` by age. A speaker draws from `any` plus the registers that fit them.
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
  const out: string[] = [...(bank.any ?? [])];
  const fit = (r: Register) => { const l = bank[r]; if (l) out.push(...l); };
  fit(voice.formality > 0.6 ? 'formal' : 'casual');
  const g: AgeGroup = voice.group;
  if (g === 'child') fit('kid');
  else if (g === 'teen' || g === 'young') fit('young');
  else if (g === 'old') fit('old');
  return out.length ? out : bank.casual ?? bank.formal ?? [];
}

export const ACTS = {
  // ---- greetings: a plain greeting gets a plain one back; "how are you?" gets an answer and the question back ----
  "greet.stranger": {
    any: ["Hello.", "{tod}.", "Hello there.", "{tod}!"],
    casual: ["Hi.", "Hiya.", "Hey."],
    formal: ["Good {todl}.", "Good {todl} to you.", "Hello, good {todl}."],
    young: ["Hey.", "Hi."],
    old: ["Good {todl}.", "Hello, dear.", "{tod}, love."],
    kid: ["Hi!", "Hello!"],
  },
  "greet.known": {
    any: ["{tod}, {name}.", "Hello, {name}.", "{name}! Hello.", "Oh, hello, {name}.", "Hello again, {name}."],
    casual: ["Hiya, {name}!", "Hey, {name}.", "There you are, {name}!", "Look who it is!", "Hey you!", "{name}! Fancy seeing you here.", "{name}! Long time no see."],
    formal: ["Good {todl}, {name}.", "{name}, how nice to see you.", "Ah, {name}. Good {todl}."],
    young: ["Hey, {name}!", "Oh hey, {name}.", "Yo, {name}.", "Heyyy, {name}."],
    old: ["Well, if it isn't {name}!", "{name}! How lovely.", "Hello, {name}, dear."],
    kid: ["Hi, {name}!", "{name}! Hi!"],
  },
  "greet.how": {
    any: ["{tod}, {name}. How are you?", "Hello, {name}. How are you?", "{name}! How are things?", "How are you, {name}?"],
    casual: ["Alright, {name}?", "{name}! How's it going?", "How's things, {name}?", "Hiya, {name}. You alright?", "Hey, {name}, how's life?"],
    formal: ["Hello, {name}. How are you keeping?", "Good {todl}, {name}. How are you?", "Hello, {name}. Are you well?"],
    young: ["Hey, {name}, you okay?", "{name}! How's it going?", "Hey, you good?"],
    old: ["Hello, {name}. Keeping well?", "How are you keeping, {name}, dear?"],
  },
  "greet.home": {
    any: ["Oh, there you are.", "You're back.", "Hello, you.", "Hi, love.", "Oh, it's you."],
    casual: ["Hey.", "You're up, then.", "Alright?"],
    young: ["Hey.", "Oh. Hi."],
    kid: ["Hi!", "Look, it's me!"],
  },
  "greet.again": { any: ["Hello again.", "Us again!", "We keep bumping into each other.", "Back again?", "Twice in one day!"], old: ["Hello again, dear."], young: ["Hey again."] },
  "greet.reply": {
    any: ["Hello.", "{tod}.", "Hello there.", "Oh, hello!", "Hello, {name}."],
    casual: ["Hiya!", "Hey!", "Oh, hey!", "Hi, {name}."],
    formal: ["Good {todl}.", "Good {todl} to you too.", "Good {todl}, {name}."],
    young: ["Hey.", "Hi.", "Oh hey, {name}."],
    old: ["Hello, dear.", "Hello, {name}, love."],
    kid: ["Hi.", "Hi, {name}!"],
  },
  "greet.fine": {
    any: ["Fine, thanks. You?", "Not bad, thanks. And you?", "Very well, thanks. You?", "Good, thanks. How about you?"],
    casual: ["Not bad, you?", "Can't complain. You?", "Surviving. You?", "Alright, ta. You?", "Same old. You?"],
    formal: ["Very well, thank you. And you?", "Quite well, thank you. And yourself?"],
    young: ["Good, you?", "Yeah, good. You?", "Fine. You?"],
    old: ["Mustn't grumble. And you?", "Fair to middling. And you, dear?", "Still here! And you?"],
    kid: ["Good! You?"],
  },
  "greet.fine.low": {
    any: ["Oh, I've been better. You?", "Bit tired, to be honest. You?", "Up and down. You?"],
    casual: ["Don't ask. You?", "Knackered. You?"],
    old: ["Oh, my back. But mustn't grumble. You?"],
  },
  "greet.fine.back": {
    any: ["Good, thanks.", "Not bad.", "Fine, fine.", "Oh, you know. Getting by.", "Can't complain."],
    casual: ["Yeah, good.", "Same old.", "Not bad at all."],
    formal: ["Very well, thank you.", "Quite well."],
    young: ["Yeah, good.", "Fine."],
    old: ["Oh, mustn't grumble.", "Still going!"],
  },

  // ---- passing on news ------------------------------------------------------------------------------------------
  "news.open": {
    any: ["Have you heard?", "Did you hear?", "You'll never guess.", "Have you heard the news?", "Did you know?", "Here's one for you."],
    casual: ["Guess what.", "Get this.", "You heard?", "So, guess what.", "Have you heard the latest?"],
    formal: ["Have you heard the news?", "I don't know if you've heard.", "Did anyone tell you?", "I wonder if you've heard."],
    young: ["Okay, so.", "Wait, have you heard?", "Okay, listen."],
    old: ["Have you heard the latest?", "Now, did you hear?", "I don't know if anyone's told you."],
    kid: ["Guess what!", "Did you know?", "Guess what I heard!"],
  },
  "news.open.also": {
    any: ["Oh, and did you hear?", "That reminds me.", "Speaking of news,", "And here's another thing.", "Oh, and another thing."],
    casual: ["Oh, and get this.", "Oh! And guess what."],
    formal: ["On another matter,", "And there was something else."],
  },
  "news.open.scandal": {
    any: ["You won't believe this.", "Oh, you'll love this.", "Wait till you hear this.", "Have you heard about {who}?", "Now this is between us."],
    casual: ["Oh my God, have you heard?", "Right, you've got to hear this.", "Get this.", "I've got gossip."],
    formal: ["I really shouldn't say, but…", "I don't like to gossip, but…", "This may surprise you."],
    young: ["Okay, this is insane.", "Oh my God. Okay.", "Wait. Did you hear about {who}?", "Okay, the drama."],
    old: ["Well! You'll never believe it.", "I've heard such a thing.", "Now, I'm not one to talk, but…"],
  },
  "news.open.sad": {
    any: ["I've got some sad news.", "Did you hear about {who}?", "I don't know if you've heard.", "Such sad news."],
    formal: ["I'm afraid there's sad news.", "I'm sorry to be the one to tell you."],
    old: ["Oh, have you heard? It's terrible.", "Such a shame, have you heard?"],
  },
  "news.open.good": {
    any: ["Have you heard the good news?", "Some good news for once!", "Did you hear about {who}?", "Nice news, have you heard?"],
    casual: ["Oh, you'll like this.", "Here's a nice one."],
    old: ["Isn't it lovely, have you heard?"],
    kid: ["Guess what! It's good!"],
  },
  "news.open.self.small": { any: ["Did I tell you?", "Oh, did I say?", "Oh, I meant to say,", "By the way,"] },
  "news.open.self": {
    any: ["Guess what?", "I've got news.", "I've got something to tell you.", "Did I tell you?"],
    casual: ["So, guess what.", "Big news.", "Right, news."],
    formal: ["I have some news, actually.", "I should tell you something."],
    young: ["Okay, big news.", "So, um. News."],
  },
  "news.open.secret": {
    any: ["Don't tell anyone, but…", "Keep this to yourself, but…", "Between you and me…", "This is just between us.", "You didn't hear this from me."],
    casual: ["Promise you won't tell?", "Don't say I said, but…", "Can you keep a secret?"],
    formal: ["I'd rather this went no further, but…", "In confidence…"],
    young: ["Okay, don't tell anyone.", "You can't tell anyone. Seriously."],
    old: ["Now, this mustn't go any further."],
  },

  // ---- hedges: how sure, and how they know ---------------------------------------------------------------------
  "hedge.witnessed": { any: ["I saw it myself.", "I was there.", "I saw it with my own eyes.", "Saw it myself.", "I was right there."] },
  "hedge.broadcast": { any: ["It was in the paper.", "It's in the paper.", "It's on the notice board.", "It's all over town.", "Everyone's talking about it."] },
  "hedge.told": {
    any: ["{src} told me.", "I heard it from {src_o}.", "That's what {src} said.", "{src} was telling me.", "According to {src_o}.", "So {src} says."],
    casual: ["{src} told me, anyway.", "Got it from {src_o}."],
    formal: ["{src} mentioned it.", "I had it from {src_o}."],
  },
  "hedge.unsure.pre": { any: ["Apparently", "People are saying", "Rumour has it", "I don't know if it's true, but", "I heard", "Someone said", "They say"] },
  "hedge.mid.pre": { any: ["Apparently", "I heard", "Seems", "So it seems,", "I hear"] },
  "hedge.unsure.post": { any: ["Or so they say.", "Don't quote me.", "If it's true.", "That's what I heard, anyway.", "Take it with a pinch of salt."] },
  "tag.embellish": {
    any: ["And it's serious.", "And it's not small, either.", "The whole street knows.", "It's worse than it sounds."],
    casual: ["And I mean properly.", "Big time."],
  },

  // ---- reactions: pure reactions, no questions ---------------------------------------------------------------
  "react.tragic": {
    any: ["Oh no.", "Oh, that's awful.", "That's terrible.", "I'm so sorry to hear that.", "Oh, how sad.", "Oh. I didn't know."],
    casual: ["Oh God, no.", "No… that's awful.", "That's rotten."],
    formal: ["How dreadful.", "I'm very sorry to hear it.", "That is sad news indeed."],
    young: ["Oh no. That's so sad.", "Wait, seriously? That's awful."],
    old: ["Oh, the poor soul.", "Oh dear, oh dear.", "God rest them.", "We're none of us getting younger."],
    kid: ["Oh no.", "That's sad."],
  },
  "react.sad": {
    any: ["Oh no, poor {who}.", "Oh dear.", "That's a shame.", "Poor thing.", "Oh, I hope {pro} {is} alright.", "That's hard."],
    casual: ["Ah, that's rough.", "Oh no. Poor {who}.", "That's awful."],
    formal: ["I'm sorry to hear that.", "That's very unfortunate.", "I do hope {pro} {is} alright."],
    old: ["Oh dear. Poor love.", "Oh, that's a shame. {Pro} {is} such a dear."],
    young: ["Aw, no.", "That sucks."],
  },
  "react.bad": {
    any: ["Oh no.", "That's a shame.", "That's not good.", "Oh dear.", "What a shame.", "Poor {who}."],
    casual: ["Ah, that's rough.", "That's a shame.", "Bad luck.", "{wow}. That's a blow."],
    formal: ["That's unfortunate.", "I'm sorry to hear it."],
    young: ["That sucks.", "Oof.", "Ugh, no."],
    old: ["Times are hard.", "Oh, it's not like it used to be."],
  },
  "react.good": {
    any: ["Oh, that's lovely!", "Oh, how nice.", "That's wonderful.", "Good for {who}!", "Oh, I am pleased.", "That's great news."],
    casual: ["Ah, brilliant!", "Nice one!", "Oh, that's great.", "About time!"],
    formal: ["How wonderful.", "That is good news."],
    young: ["Aw, cute!", "No way, that's amazing!", "Love that.", "That's so nice."],
    old: ["Oh, how lovely.", "Isn't that nice.", "Well, I never. Good for {who}."],
    kid: ["Cool!", "Yay!"],
  },
  "react.good.grudging": {
    any: ["Huh. Good for {who}, I suppose.", "Well. Good luck to {pro_obj}.", "Lucky {who}.", "Hm. Some people have all the luck."],
    casual: ["Huh. Didn't see that coming.", "Right. Good for {pro_obj}."],
  },
  "react.scandal.gossip": {
    any: ["No!", "You're joking!", "Get away!", "I knew it!", "Never!", "Well, well, well.", "Who'd have thought it."],
    casual: ["{wow}!", "Shut up!", "No way!", "I knew there was something!", "Oh, that's juicy."],
    formal: ["Good heavens.", "Goodness me!", "Well, I never."],
    young: ["No way!", "Oh my God.", "Stop it.", "That's wild."],
    old: ["Well, I never!", "Goodness gracious!"],
    kid: ["Whoa!"],
  },
  "react.scandal.prim": {
    any: ["That's none of our business, really.", "Well, that's not very nice.", "I'd rather not know.", "People should mind their own business.", "That's their affair."],
    formal: ["I don't think we should be talking about this.", "That's hardly our concern."],
    old: ["Disgraceful.", "In my day we didn't talk about such things."],
  },
  "react.crime": {
    any: ["That's awful.", "In this town!", "Shocking.", "You're not safe anywhere these days.", "That's horrible."],
    casual: ["{wow}. Here, of all places.", "That's scary.", "I'm locking my door tonight."],
    old: ["It was never like this before.", "What is the world coming to."],
    young: ["That's so creepy.", "Here? That's mad."],
  },
  "react.news": {
    any: ["Oh, really?", "Is that right?", "I didn't know that.", "Huh, I hadn't heard.", "Well, there you go.", "Fancy that.", "Oh, good for them."],
    casual: ["Oh yeah?", "Huh. Interesting.", "No kidding."],
    formal: ["Is that so?", "How interesting.", "I hadn't heard."],
    young: ["Oh, okay.", "Huh, cool.", "Wait, really?"],
    old: ["Well, I never.", "Is that so? Fancy."],
  },
  "react.politics": {
    any: ["About time.", "We'll see.", "Well, someone has to do it.", "That'll go down well.", "Hm. Interesting."],
    casual: ["Oh, great. Here we go.", "Typical.", "Can't be worse than the last lot."],
    formal: ["I'll be interested to see how that goes.", "That's worth keeping an eye on."],
    old: ["They're all the same.", "In my day the council actually did things."],
  },
  "react.event": {
    any: ["Oh, nice.", "Thanks for telling me.", "I'll put it in the diary.", "Might go to that."],
    casual: ["Oh, cool.", "Might pop along."],
  },
  "react.family.bad": {
    any: ["I know. It's been hard on all of us.", "Yes. We're all a bit shaken.", "I know. Please don't spread it around.", "Yes. It's my {tie}, you know."],
    casual: ["Yeah. Don't remind me.", "I know. It's rough."],
  },
  "react.family.scandal": {
    any: ["That's my {tie} you're talking about!", "That's not true.", "You shouldn't listen to gossip.", "Leave my {tie} out of it."],
    casual: ["Oi. That's my {tie}.", "Watch it. That's family."],
  },
  "react.family.good": {
    any: ["I know! We're so pleased.", "Isn't it great? We're all thrilled.", "I know, we're very proud.", "Yes! My {tie}, can you believe it?"],
  },
  "family.scandal.back": { any: ["Sorry. I'm only saying what I heard.", "Sorry, I didn't mean anything by it.", "Oh. I didn't realise. Sorry.", "Sorry. Forget I said it."] },
  "react.knew": { any: ["I know, I heard.", "Yes, I'd heard.", "Old news, I'm afraid.", "So I hear.", "I know. Everyone's talking about it."], casual: ["Yeah, I know.", "Heard that already."] },
  "knew.back": { any: ["Ah, you'd heard.", "Word gets round, doesn't it?", "Nothing stays secret here.", "Of course you had."] },
  "react.self.good": { any: ["Congratulations!", "Oh, that's wonderful news!", "Well done, you!", "Oh, I'm so happy for you.", "Brilliant!"] },
  "react.self.bad": { any: ["Oh, I'm so sorry.", "That's awful. If there's anything I can do…", "I'm sorry. That must be hard."] },
  "react.self.news": { any: ["Oh, really?", "Well, I never.", "Oh, how nice.", "Oh! I didn't know."] },
  "react.yours.good": { any: ["Oh, you must be proud!", "How lovely for you all!", "Oh, that's wonderful for your family.", "Give {who} my congratulations."] },
  "react.yours.bad": { any: ["Oh, I'm so sorry. Give {who} my best.", "Oh no. How are you all holding up?", "I'm so sorry to hear that.", "That must be hard for you all."] },
  "segue": { any: ["Anyway,", "Anyway.", "Still,", "Oh, by the way,", "On another note,"], casual: ["Anyway,", "Right, anyway."], kid: ["Anyway,"] },
  "react.yours.scandal": { any: ["Oh no. What happened?", "Goodness, what was that about?", "Oh dear. Is everyone alright?", "Oh no. What a business."] },
  "react.yours.scandal.answer": { any: ["Don't ask.", "I'd rather not talk about it.", "Nobody really knows.", "It's all a bit of a mess.", "We're sorting it out."] },
  "react.self.knew": { any: ["Yes, I heard! Lovely.", "So I heard!", "I know, someone told me.", "Yes, I heard. How lovely."] },
  "react.yours.answer": { any: ["We're managing, thanks.", "Getting there, thanks.", "Day by day.", "Oh, you know. We'll be alright.", "As well as can be."] },
  "react.self.close": { any: ["Thanks.", "Thank you.", "Thanks, that's kind.", "Cheers."] },

  // ---- doubt and where it came from ----------------------------------------------------------------------------
  "doubt": {
    any: ["I'm not sure about that.", "Hm. I'll believe it when I see it.", "That doesn't sound right.", "I doubt it.", "Really? I find that hard to believe."],
    casual: ["Pull the other one.", "Yeah, right.", "Come off it.", "Nah, can't be."],
    formal: ["I find that hard to believe.", "I'd want to hear that from someone else."],
    young: ["Yeah, sure.", "Is that even true?"],
    old: ["People will say anything these days.", "I'll believe it when I see it."],
  },
  "doubt.who": { any: ["That doesn't sound like {who}.", "{who}? Never.", "Not {who}. I don't believe it."] },
  "defend.witnessed": { any: ["It's true! I saw it myself.", "I was there, I'm telling you.", "I saw it with my own eyes."] },
  "defend.told": { any: ["{src} told me, and {src_pro} should know.", "It's true, {src} said so.", "Ask {src_o} yourself.", "{src} wouldn't make it up."] },
  "defend.vague": { any: ["Well, that's what everyone's saying.", "Suit yourself. That's what I heard.", "Believe what you like.", "That's what's going round."] },
  "doubt.close": { any: ["Hm. If you say so.", "We'll see.", "Well, maybe.", "I'll wait and see.", "If you say so."] },
  "ask.source": { any: ["Who told you that?", "Where did you hear that?", "Who said?", "Where's that from?"] },
  "answer.source": { any: ["{src} did.", "I heard it from {src_o}.", "{src} told me.", "It was {src_o}, actually."], casual: ["{src} did. Don't tell {src_them} I said."] },
  "answer.source.vague": { any: ["Oh, people are talking.", "Just something I heard.", "Everyone's saying it.", "I can't remember now."] },
  "answer.source.self": { any: ["{Pro} told me {self}.", "From the horse's mouth: {pro} told me {self}.", "{Pro} said so {self}."] },
  "answer.witnessed": { any: ["I saw it myself.", "I was there!", "With my own eyes."] },
  "source.trusted": { any: ["Oh, well, if {src} says so.", "Then it must be true.", "{src} would know.", "Ah. Then I believe it."] },
  "source.doubted": { any: ["{src}? I'd take that with a pinch of salt.", "Oh, {src} says all sorts.", "Hm. Consider the source.", "{src}? Well, maybe."] },
  "source.neutral": { any: ["Oh, right.", "I see.", "Ah.", "Huh."] },
  "source.vague.back": { any: ["Hm. Well, people say all sorts.", "Right. We'll see.", "Hm."] },

  // ---- two versions of a story -----------------------------------------------------------------------------------
  "correct": {
    any: ["That's not what I heard. I heard {fact}.", "No, I heard {fact}.", "Really? The way I heard it, {fact}.", "Hang on, I heard {fact}.", "That's not how I heard it. {Fact}, I was told."],
    formal: ["I believe you're mistaken. I was told {fact}.", "I heard something rather different: {fact}."],
  },
  "correct.src": { any: ["Funny, {src} told me {fact}.", "Hang on, {src} told me {fact}."] },
  "correct.worse": { any: ["Oh, it's worse than that, I heard.", "Worse, from what I heard.", "That's putting it mildly, from what I heard.", "I heard it was a lot worse."] },
  "correct.milder": { any: ["Hm, I heard it wasn't that bad.", "I think that's been blown up a bit.", "People do exaggerate. It wasn't that bad, I heard.", "Not so bad as all that, from what I heard."] },
  "insist.witnessed": { any: ["No, I saw it myself.", "I was there. I know what I saw.", "I'm sure of it, I saw it."] },
  "insist.told": { any: ["Well, {src} was sure.", "That's what {src} told me, and {src_pro} should know.", "I'm only saying what {src} said."] },
  "concede": { any: ["Oh. Maybe I've got it wrong.", "Could be. I only heard it second-hand.", "Well, you may be right.", "Huh. Then someone's got it muddled.", "Maybe. Who knows, with this town."] },
  "worse.back": { any: ["Is it? I hadn't heard that.", "Oh no, really?", "Worse? Oh dear.", "Goodness. I only heard the half of it, then."] },
  "milder.back": { any: ["Well, that's how it was told to me.", "Maybe. People do exaggerate.", "Oh, good. I hope you're right.", "Could be. You know how stories grow."] },
  "differ.close": { any: ["Well, we'll find out.", "Time will tell.", "One of us is wrong, then.", "We'll see who's right."] },
  "concede.close": { any: ["Easy mistake.", "That's how stories go.", "Ah well.", "Could be either, I suppose."] },

  // ---- after the reaction: a detail, a question ----------------------------------------------------------------
  "detail.heard": { any: ["I only heard {ago}.", "Heard it {ago}.", "It was {ago} I heard.", "Only found out {ago}."] },
  "detail.place": { any: ["At {P}, of all places.", "Right there at {P}.", "It was at {P}, apparently.", "At {P}, too."] },
  "detail.ack": { any: ["Goodness.", "Really.", "Hm.", "Well, well.", "Is that right."] },
  "ask.funeral": { any: ["When's the funeral?", "Do you know when the funeral is?", "Is there a funeral yet?"] },
  "ask.wedding": { any: ["When's the wedding?", "Have they set a date?", "Do you know when the wedding is?"] },
  "ask.jobless": { any: ["What will {pro} do now?", "How's {pro} taking it?", "Has {pro} got anything else lined up?"] },
  "ask.ill": { any: ["How bad is it?", "Do they know what it is?", "Is {pro} at home?"] },
  "ask.baby": { any: ["Boy or girl?", "Do you know if it's a boy or a girl?"] },
  "answer.when": { any: ["{When}, I think.", "{When}. At {P}.", "It's {when}, I heard.", "{When}, at {P}, I think."] },
  "answer.dunno": { any: ["I don't know yet.", "No idea.", "Nobody's said.", "I don't know, to be honest.", "Couldn't tell you."] },
  "answer.dunno.close": { any: ["Let me know if you hear.", "Well, keep me posted.", "I'll find out.", "Poor thing."] },
  "answer.when.close": { any: ["I'll be there.", "I'll try to go.", "Thanks. I'll make a note.", "Right. I'll be there if I can."] },
  "answer.kid": { any: ["A little {kid}.", "A {kid}, I heard.", "{Kid}! Lovely, isn't it?"] },
  "answer.kid.close": { any: ["Oh, lovely.", "Aw.", "How lovely.", "Lovely news."] },
  "secret.close": { any: ["Don't tell anyone I told you.", "Keep it to yourself.", "Not a word, mind.", "You didn't hear it from me."] },
  "secret.reply": { any: ["My lips are sealed.", "I won't say a word.", "Of course.", "Who would I tell?"] },

  // ---- small talk: openers are statements or tag questions; replies agree ------------------------------------------
  "weather.rain": {
    any: ["Awful weather.", "It's not stopping, is it?", "Raining again.", "Lovely weather for ducks.", "Miserable out there.", "Another wet one."],
    casual: ["Chucking it down, isn't it?", "Typical. Rain again.", "I'm soaked.", "Proper wet out there."],
    old: ["My knees knew it would rain.", "It's the gardens I feel for."],
    young: ["Ugh, this rain.", "I'm drenched."],
  },
  "weather.drizzle": { any: ["Bit drizzly.", "This drizzle gets everywhere.", "Can't decide if it's raining or not.", "Damp old day.", "Spitting again."] },
  "weather.storm": { any: ["What a storm!", "Wild out there.", "Best stay in today.", "The lights flickered at ours.", "That thunder!"] },
  "weather.snow": {
    any: ["Look at all this snow!", "Snow again.", "Mind how you go, it's slippery.", "Proper winter, this.", "It's really coming down."],
    kid: ["It's snowing!", "I want to build a snowman!"],
    old: ["Careful on the ice, at our age.", "Winters were worse when I was young."],
    young: ["So much snow!", "Snow day, surely."],
  },
  "weather.ice": { any: ["Mind the ice.", "It's like a skating rink out there.", "Nearly went over on the path.", "Treacherous underfoot."] },
  "weather.cold": {
    any: ["Cold today.", "Bitter out, isn't it?", "Freezing, isn't it?", "There's a nip in the air.", "Chilly one."],
    casual: ["Brass monkeys out there.", "It's perishing.", "I can't feel my fingers."],
    old: ["It goes right through you.", "This cold gets into my bones."],
  },
  "weather.hot": {
    any: ["Isn't it hot?", "What a scorcher.", "Too hot for me.", "Hot one today.", "Close, isn't it?"],
    casual: ["I'm melting.", "Boiling, isn't it?"],
    young: ["It's so hot.", "Ice cream weather!"],
    kid: ["It's so hot!", "I want to go swimming!"],
  },
  "weather.nice": {
    any: ["Lovely day, isn't it?", "Beautiful day.", "Gorgeous out.", "Nice to see the sun.", "Isn't it a lovely {todl}?", "What a day."],
    casual: ["Cracking day.", "Proper nice out."],
    old: ["Lovely day.", "You can't beat a day like this."],
  },
  "weather.fog": { any: ["Foggy this {todl}.", "Can hardly see across the road.", "Thick fog today.", "This fog!"] },
  "weather.grey": { any: ["Grey old day.", "Dull, isn't it?", "Bit miserable out.", "Could do with some sun.", "Not much of a day.", "Gloomy, isn't it?", "Bit grey today."] },
  "weather.windy": { any: ["Windy, isn't it?", "Nearly blew away.", "Blowing a gale out there.", "Hold on to your hat."] },
  "weather.mild": {
    any: ["Not a bad day.", "Not bad out, is it?", "Pleasant enough today.", "Nice enough day.", "Decent day.", "Not too bad out there.",
      "[Fairly|Quite] mild today.", "Bit of sun, at least.", "Nice {todl}, isn't it?", "Dry, at least.", "Could be worse out.", "Calm today, isn't it?",
      "Not a bad {todl}.", "Can't complain about the weather today.", "Nice and mild.", "Quite pleasant out, isn't it?"],
    old: ["Kind weather today.", "Not a bad old day."],
    young: ["Nice out, kind of.", "Weather's okay today."],
  },
  "weather.reply.bad": {
    any: ["Isn't it.", "I know.", "Tell me about it.", "You're not wrong.", "Horrible, isn't it?"],
    casual: ["Yeah, I know.", "Don't get me started.", "Grim."],
    formal: ["Quite.", "Indeed it is.", "Dreadful."],
    old: ["It is, it is.", "Never seen the like."],
  },
  "weather.reply.nice": {
    any: ["Isn't it.", "Lovely.", "Makes a change.", "Long may it last.", "Not bad at all.", "I'll take it.", "It is, isn't it?", "Better than rain.",
      "Can't ask for more.", "Mm, nice enough.", "Not complaining.", "Suits me."],
    casual: ["Can't complain.", "Yeah, nice.", "Not bad, eh?"],
    formal: ["Very pleasant.", "It is indeed.", "Most agreeable."],
    old: ["Good drying weather.", "Good for the garden."],
  },
  "weather.reply.bright": { any: ["Still, it'll pass.", "Good for the gardens, mind.", "Better than last week, though.", "Ah, could be worse."] },
  "weather.more.bad": { any: ["Supposed to go on all week.", "And they said it would clear up.", "I've had enough of it.", "Won't let up, will it?"] },
  "weather.more.nice": { any: ["Make the most of it, I say.", "Won't last, mind.", "Supposed to stay like this all week.", "I'm going to sit in the garden later."] },
  "weather.more.ack": { any: ["Mm.", "Typical.", "We'll see.", "Fingers crossed.", "Let's hope."] },
  "occasion.ask": {
    any: ["Are you going to {occ} {when}?", "Going to {occ} {when}?", "Will we see you at {occ} {when}?", "You coming to {occ} {when}?"],
    formal: ["Will you be at {occ} {when}?"],
  },
  "occasion.say": { any: ["{Occ} is {when}, isn't it?", "Don't forget {occ} {when}.", "It's {occ} {when}.", "Big day {when}: {occ}."] },
  "occasion.say.reply": { any: ["Oh, is it?", "Thanks for reminding me.", "I know, I can't wait.", "Already in the diary.", "Oh, I'd forgotten.", "So it is."] },
  "occasion.yes": { any: ["Wouldn't miss it.", "Yes, I'll be there.", "I think so.", "Of course.", "If I can get away."] },
  "occasion.no": { any: ["Not this time.", "Can't, I'm afraid.", "Probably not.", "Not really my thing.", "I'll see how I feel."] },
  "occasion.yes.back": { any: ["See you there, then.", "Good, see you there.", "Great, save me a spot.", "Lovely."] },
  "occasion.no.back": { any: ["Shame.", "Oh, go on, it'll be fun.", "Fair enough.", "Another time, then."] },
  "occasion.sad": { any: ["Are you going to {occ} {when}?", "I suppose you'll be at {occ} {when}."] },
  "occasion.sad.reply": { any: ["Yes. Have to pay my respects.", "I will. Such a shame.", "Yes. It'll be a sad day.", "I think so."] },
  "holiday.christmas": { any: ["Merry Christmas!", "Happy Christmas!", "Merry Christmas to you and yours."] },
  "holiday.christmasEve": { any: ["All ready for tomorrow?", "Got all your presents?", "Nearly Christmas!"], kid: ["Is it Christmas yet?", "Santa comes tonight!"] },
  "holiday.newYear": { any: ["Happy New Year!", "All the best for the new year!"] },
  "holiday.newYearsEve": { any: ["Last day of the year!", "Going to see the fireworks?", "Doing anything tonight?"] },
  "holiday.easter": { any: ["Happy Easter!", "Lovely Easter weekend."], kid: ["I found five eggs!"] },
  "holiday.halloween": { any: ["Got your sweets in for tonight?", "Ready for the trick-or-treaters?"], kid: ["Trick or treat!", "I'm going as a ghost!"] },
  "holiday.summerFestival": { any: ["Going to the festival?", "The festival's on!", "Have you been down to the festival yet?"] },
  "holiday.christmasMarket": { any: ["Been to the Christmas market yet?", "The Christmas market's on.", "Smell that mulled wine."] },
  "holiday.reply.greeting": { any: ["And to you!", "You too!", "Same to you!", "Thank you, and you."] },
  "holiday.reply.question": { any: ["Yes, I think so.", "Not yet, but I will.", "Oh, I'm all set.", "Haven't had a minute.", "Wouldn't miss it."] },
  "holiday.reply.statement": { any: ["Isn't it lovely?", "I know!", "It's the best time of year.", "Lovely, isn't it?"] },
  "lore": {
    any: ["You know, {lore}.", "Funny thing, {lore}.", "Someone told me {lore}.", "Here's a thing: {lore}.", "They say {lore}."],
    old: ["When I was young, they used to say {lore}.", "My father used to say {lore}."],
    young: ["Apparently {lore}.", "Fun fact: {lore}."],
  },
  "lore.reply.known": { any: ["Everyone knows that!", "Yes, so they say.", "I've heard that.", "That's true enough.", "So I've heard."] },
  "lore.reply.new": { any: ["Is that right?", "I didn't know that.", "Huh, really?", "You learn something every day.", "Well, there you go."] },
  "tired": {
    any: ["I'm worn out.", "Long day.", "I could sleep for a week.", "I'm dead on my feet."],
    casual: ["I'm shattered.", "Knackered, me."],
    young: ["So tired.", "Need sleep."],
    old: ["These old bones need a rest."],
  },
  "tired.reply": { any: ["Get an early night.", "Me too.", "Go home and put your feet up.", "You look it.", "I know the feeling."] },
  "hungry": { any: ["I'm starving.", "Could eat a horse.", "I haven't eaten all day.", "My stomach's rumbling."] },
  "hungry.reply": { any: ["Me too.", "Go and get something.", "You should eat something.", "Same here, now you mention it."] },
  "work.ask": { any: ["Busy at {work}?", "How's work?", "Keeping busy?", "How are things at {work}?", "Work treating you alright?"] },
  "work.reply": {
    any: ["Never stops.", "Busy, busy.", "Quiet, actually.", "Can't complain.", "Same as ever.", "Mad. Don't ask.", "Could be worse."],
    casual: ["Don't talk to me about work.", "It pays the bills."],
    young: ["It's fine. Boring.", "Ugh. Don't ask."],
  },
  "work.back": { any: ["I know the feeling.", "Ha. Same here.", "Rather you than me.", "Hang in there."] },
  "school.ask": { any: ["How's school?", "How's school going?", "School alright?", "How are you getting on at school?"] },
  "school.reply": { any: ["Fine.", "Boring.", "Okay.", "We had a test.", "It's alright."], young: ["Ugh. Fine.", "Don't ask."] },
  "school.back": { any: ["Good. Keep at it.", "Ha. I remember that.", "Best years of your life, you know.", "Well, stick with it."] },
  "family.ask": { any: ["How's {kin}?", "How's {kin} doing?", "And how's {kin}?", "Is {kin} keeping well?"] },
  "family.reply": {
    any: ["{Pro} {is} fine, thanks.", "{Pro} {is} doing well.", "Oh, you know. Up and down.", "Same as ever.", "Very well, thank you.", "Keeping busy."],
    casual: ["Yeah, good, thanks.", "Still going strong!"],
  },
  "family.reply.ill": { any: ["Not so good, to be honest.", "{Pro} {is} poorly, actually.", "We're worried, to be honest."] },
  "family.back": { any: ["Glad to hear it.", "Give {pro_obj} my love.", "Say hello from me.", "Good, good."] },
  "family.back.ill": { any: ["Oh, I'm sorry. Send my best.", "Oh no. Give {pro_obj} my love.", "I'll keep {pro_obj} in my thoughts.", "If there's anything I can do…"] },
  "mood.low": {
    any: ["Not a great day, to be honest.", "Bit down today.", "One of those days."],
    young: ["Ugh, today.", "I'm so done with today."],
    old: ["Mustn't grumble. But I will."],
  },
  "mood.low.reply": { any: ["Oh no. Chin up.", "It'll get better.", "Sorry to hear that.", "Hang in there."] },
  "mood.low.cold": { any: ["Hm.", "We all have those.", "Oh well.", "It happens."] },
  "mood.high": { any: ["I'm in a good mood today.", "Feeling good today.", "Everything's going right for once."] },
  "mood.high.reply": { any: ["Good for you!", "Glad to hear it.", "Long may it last.", "Nice, I like to hear that."] },
  // A remark about the place they are in: something nice ("good") or a moan, and a reply that fits either kind.
  // ---- what the other one is up to ----------------------------------------------------------------------------
  "doing.shop": { any: ["Getting the shopping in?", "Doing the big shop?", "Stocking up?"] },
  "doing.shop.reply": { any: ["Just a few bits.", "Only the essentials.", "Never-ending, isn't it?", "Someone has to."], kid: ["Mum needed milk."] },
  "doing.walkDog": { any: ["Out with the dog?", "Taking the dog round?", "Walkies, is it?"] },
  "doing.walkDog.reply": { any: ["Yes, needs the exercise.", "Whatever the weather.", "Morning and night.", "Somebody's got to."] },
  "doing.exercise": { any: ["Out for a run?", "Keeping fit?", "Look at you, all sporty."] },
  "doing.exercise.reply": { any: ["Trying to.", "Have to keep moving.", "Don't let the face fool you, I'm dying.", "Doctor's orders."] },
  "doing.errand": { any: ["Running errands?", "Busy day?", "Off somewhere?"] },
  "doing.errand.reply": { any: ["Just a few jobs.", "Never stops.", "Post office, then the bank.", "Just popping out."] },
  "doing.eat": { any: ["Having a bite to eat?", "Grabbing something to eat?", "Treating yourself?"] },
  "doing.eat.reply": { any: ["Couldn't face cooking.", "Just a quick one.", "Why not.", "I'd earned it."] },
  "doing.doctor": { any: ["Everything alright?", "Nothing serious, I hope?"] },
  "doing.doctor.reply": { any: ["Just a check-up.", "Oh, nothing much.", "Routine stuff.", "Just a prescription."] },
  "doing.travel": { any: ["Where are you off to?", "Off somewhere nice?", "In a hurry?"] },
  "doing.travel.reply": { any: ["Just into town.", "Only round the corner.", "Running late, as usual.", "Home, finally."] },
  "doing.worship": { any: ["Off to church?", "Nice service?"] },
  "doing.worship.reply": { any: ["Every week.", "Wouldn't miss it.", "It was lovely, actually."] },
  "doing.leisure": { any: ["Taking it easy?", "Day off?", "Enjoying yourself?"] },
  "doing.leisure.reply": { any: ["Trying to.", "First time in ages.", "Making the most of it.", "Somebody has to."] },

  // ---- the time of year and the weekend -------------------------------------------------------------------------
  "season.winter": { any: ["Dark so early now.", "These dark mornings.", "Frost on the cars again."] },
  "season.spring": { any: ["Evenings are getting lighter.", "Everything's coming up green.", "Feels like spring at last.", "The birds are back."] },
  "season.summer": { any: ["Long evenings, aren't they?", "Summer's flying by.", "Lovely light evenings."] },
  "season.autumn": { any: ["The leaves are turning.", "Nights are drawing in.", "Autumn already.", "Getting colder in the mornings."] },
  "season.reply": { any: ["Isn't it.", "Where does the time go?", "Every year it surprises me.", "I know.", "Mm, it is."] },
  "weekend.ask": { any: ["Doing anything this weekend?", "Any plans for the weekend?", "Got the weekend off?"] },
  "weekend.reply": { any: ["Not much. Bit of gardening.", "Seeing the family.", "Putting my feet up.", "Haven't thought that far.", "Sorting the house out."] },
  "weekend.back": { any: ["Sounds nice.", "Lucky you.", "Enjoy it.", "Fair enough."] },

  "place.pub.good": { any: ["Quiet in here tonight.", "Good pint, this.", "Nice to sit down after a day like this.", "Nice and cosy in here."] },
  "place.cafe.good": { any: ["The coffee's good here.", "The cake here is lovely.", "Nice and warm in here.", "Best coffee in town, this."] },
  "place.bakery.good": { any: ["Smells lovely in here.", "Nothing beats fresh bread.", "Their rolls are the best."] },
  "place.bakery.moan": { any: ["They've sold out of rolls again.", "Long queue today.", "Always a queue in here."] },
  "place.shop.moan": { any: ["Prices keep going up.", "They've moved everything again.", "Long queue today.", "Half the shelves are empty."] },
  "place.church.good": { any: ["Nice service.", "Good turnout today.", "Lovely hymns.", "Lovely sermon today."] },
  "place.park.good": { any: ["Lovely spot, this.", "Nice for a walk.", "Look at the ducks.", "I could sit here all day."] },
  "place.school.moan": { any: ["Big test this week.", "Too much homework.", "So much homework."] },
  "place.doctor.moan": { any: ["Always a wait in here.", "Been waiting ages.", "Full in here today."] },
  "place.reply.good": { any: ["Mm.", "Can't beat it.", "Isn't it just.", "That it is.", "Mm, I know."], casual: ["Too right.", "Can't argue with that."] },
  "place.reply.moan": { any: ["Tell me about it.", "Always the way.", "I know.", "You're telling me.", "Typical."], young: ["Ugh, I know."] },

  // ---- endings ---------------------------------------------------------------------------------------------------
  "part": {
    any: ["See you.", "Take care.", "Bye then.", "See you later.", "Must dash.", "Mind how you go.", "Right, I'd better be off."],
    casual: ["See ya.", "Catch you later.", "Right, I'm off."],
    formal: ["Good {todl} to you.", "Do take care.", "Lovely to see you."],
    young: ["See ya.", "Bye!", "Later."],
    old: ["Look after yourself.", "Don't be a stranger.", "Lovely to see you, dear."],
    kid: ["Bye!", "See you tomorrow!"],
  },
  "part.heavy": { any: ["Well. I'd better get on.", "What a thing. Take care.", "Anyway. I'll let you go.", "Sad times. See you.", "Well, I'd best be off."] },
  "part.night": { any: ["Night.", "Goodnight.", "Sleep well.", "Night, then."] },
  "part.reply": { any: ["Bye.", "See you.", "Take care.", "Bye now.", "See you around."], young: ["Bye.", "Later."], kid: ["Bye!"] },
  "snub": { any: ["Sorry, I have to go.", "Can't stop.", "Not now.", "I'm in a hurry.", "Excuse me."], casual: ["Got to go.", "Not today."] },
  "snub.reply": { any: ["Charming.", "Well!", "Suit yourself.", "Fine.", "What did I do?"] },
  // ---- a word to a baby or toddler ----------------------------------------------------------------------------
  "little": { any: ["Hello, little one!", "Aren't you a sweetie?", "Look at you!", "Hello, {name}! Hello!", "Who's this, then?"], kid: ["Hi, baby!", "Can I hold {name}?"] },
  "little.own": { any: ["Come here, {name}.", "Who's a sleepy {boy}?", "Careful, {name}.", "Let's get you a snack.", "Not in your mouth, {name}!", "Up you come."], kid: ["Look, {name}, look!", "Come on, {name}."] },
  "animal.own.dog": { any: ["Good {boy}!", "Who's a good {boy}?", "Come on, {pet}!", "Leave it, {pet}.", "Heel, {pet}.", "Walkies!", "Sit, {pet}. Good."] },
  "animal.own.cat": { any: ["Hello, {pet}.", "There you are, {pet}.", "Are you hungry, {pet}?", "Off the table, {pet}!", "Who's purring?"] },
  "animal.dog": { any: ["Hello, {boy}.", "Aren't you lovely?", "Hello there, doggy.", "Good dog.", "Who's this, then?"], kid: ["Doggy!", "Can I pet {it}?"] },
  "animal.cat": { any: ["Hello, puss.", "Here, kitty.", "Aren't you pretty?", "Psst, puss puss."], kid: ["Kitty!"] },
  "animal.farm": { any: ["Come on, then.", "Steady.", "There you go.", "Easy, now.", "Hup, hup!"] },
  "animal.wild": { any: ["Oh, look!", "Look, a {species}!", "Shh, you'll scare it.", "Well, hello there."] },
} as const satisfies Record<string, Bank>;

export type ActName = keyof typeof ACTS;
