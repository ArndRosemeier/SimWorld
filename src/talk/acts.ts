/**
 * The phrase banks of the chatter engine (plan §4.2): what people say for each speech act, by register. Written at
 * authoring time (Arnd's decision: authoring-time LLM = Claude) and curated; shipped as static data.
 *
 * Registers: `any` is for everyone; `casual` or `formal` by the speaker's formality; `young` (teens and young
 * adults), `old` and `kid` by age. A speaker draws from `any` plus the registers that fit them.
 *
 * Slots (filled by src/talk/chatter.ts): {name} the listener's first name, {tod} "Morning"/"Afternoon"/"Evening",
 * {wow} an exclamation by swearing level, {src} who told the speaker, {fact} a story as a clause, {occ} an
 * occasion, {when} "today"/"tomorrow"/"on Saturday", {lore} a piece of local knowledge, {kin} someone close to the
 * listener, {pro} their pronoun, {is} its agreement, {work} the listener's workplace, {here} this place,
 * {temp} the temperature, {season} the season.
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
  // ---- greetings ------------------------------------------------------------------------------------------------
  'greet.stranger': {
    any: ['Hello.', '{tod}.', 'Hello there.', '{tod}!'],
    casual: ['Hi.', 'Hiya.', 'Alright?', 'Hey.', '{tod}, how are you?'],
    formal: ['Good {todl}.', 'Good {todl} to you.', 'How do you do?', 'Hello, good {todl}.'],
    young: ['Hey.', 'Hi.', 'Alright?'],
    old: ['Good {todl}.', 'Hello, dear.', '{tod}, love.'],
    kid: ['Hi!', 'Hello!'],
  },
  'greet.known': {
    any: ['{tod}, {name}.', 'Hello, {name}.', '{name}! Hello.', 'Oh, hello, {name}.', '{tod}, {name}. How are you?'],
    casual: ['Hiya, {name}!', 'Alright, {name}?', 'Hey, {name}.', 'There you are, {name}!', '{name}! How\'s it going?', 'Look who it is!', 'Hey you!', '{name}! [Long time no see|Fancy seeing you here].'],
    formal: ['Good {todl}, {name}.', 'Hello, {name}. How are you keeping?', '{name}, how nice to see you.', 'Ah, {name}. Good {todl}.'],
    young: ['Hey, {name}!', '{name}! What\'s up?', 'Yo, {name}.', 'Heyyy, {name}.', 'Oh hey, {name}.'],
    old: ['Hello, {name}, dear.', 'Well, if it isn\'t {name}!', '{name}! How lovely.', 'Hello, {name}. Keeping well?'],
    kid: ['Hi, {name}!', '{name}! Hi!', 'Hey, {name}!'],
  },
  'greet.home': {
    any: ['Oh, there you are.', 'You\'re back.', 'Hello, you.', 'Hi, love.', 'Oh, it\'s you.'],
    casual: ['Alright?', 'Hey.', 'You\'re up, then.', 'Good day?'],
    young: ['Hey.', 'Oh. Hi.', 'Hey, what\'s up?'],
    kid: ['Hi!', 'Look what I did!', 'Can I have a snack?'],
  },
  'greet.reply.stranger': {
    any: ['Hello.', '{tod}.', 'Hello there.'],
    casual: ['Hi.', 'Alright.', 'Hiya.', 'Not bad, you?'],
    formal: ['Good {todl}.', 'Good {todl} to you too.', 'How do you do.'],
    young: ['Hey.', 'Hi.'],
    old: ['Hello, dear.', 'Good {todl}.'],
    kid: ['Hi.', 'Hello.'],
  },
  'greet.reply.known': {
    any: ['Hello, {name}.', '{tod}, {name}.', 'Oh, hello!', 'Hello, you.', 'Hi, {name}. Fine, thanks.'],
    casual: ['Hiya!', 'Alright, {name}!', 'Hey! Not bad, you?', 'Oh, hey!', 'Can\'t complain. You?', 'Surviving. You?'],
    formal: ['Good {todl}, {name}. Very well, thank you.', 'Hello, {name}. Very well, and you?', 'Ah, {name}. Good {todl}.'],
    young: ['Hey!', 'Oh, hey, {name}.', 'Not much. You?', 'Yo.'],
    old: ['Hello, dear. Mustn\'t grumble.', 'Oh, hello, {name}. Fair to middling.', 'Still here, {name}, still here.'],
    kid: ['Hi!', 'Hi, {name}!'],
  },

  // ---- passing on news ------------------------------------------------------------------------------------------
  'news.open': {
    any: ['Have you heard?', 'Did you hear?', 'You\'ll never guess.', 'Have you heard the news?', 'Did you know?', 'Here\'s one for you.'],
    casual: ['Guess what.', 'Get this.', 'You heard?', 'So, guess what.', 'Have you heard the latest?'],
    formal: ['Have you heard the news?', 'I don\'t know if you\'ve heard.', 'Did anyone tell you?', 'I wonder if you\'ve heard.'],
    young: ['Okay, so.', 'Did you hear?', 'Wait, have you heard?', 'Okay, listen.'],
    old: ['Have you heard the latest?', 'Now, did you hear?', 'I don\'t know if anyone\'s told you.'],
    kid: ['Guess what!', 'Did you know?', 'Guess what I heard!'],
  },
  'news.open.scandal': {
    any: ['You won\'t believe this.', 'Oh, you\'ll love this.', 'Wait till you hear this.', 'Have you heard about {who}?', 'Now this is between us.'],
    casual: ['Oh my God, have you heard?', 'Right, you\'ve got to hear this.', 'Get this.', 'Hold on to something.', 'I\'ve got gossip.'],
    formal: ['I really shouldn\'t say, but…', 'I don\'t like to gossip, but…', 'This may surprise you.'],
    young: ['Okay, this is insane.', 'Oh my God. Okay.', 'Wait. Did you hear about {who}?', 'Okay, the drama.'],
    old: ['Well! You\'ll never believe it.', 'I\'ve heard such a thing.', 'Now, I\'m not one to talk, but…'],
  },
  'news.open.sad': {
    any: ['Have you heard? It\'s sad news.', 'I\'ve got some sad news.', 'Did you hear about {who}?', 'I don\'t know if you\'ve heard.', 'Such sad news.'],
    formal: ['I\'m afraid there\'s sad news.', 'I\'m sorry to be the one to tell you.'],
    old: ['Oh, have you heard? It\'s terrible.', 'Such a shame, have you heard?'],
  },
  'news.open.good': {
    any: ['Have you heard the good news?', 'Some good news for once!', 'Did you hear about {who}?', 'Nice news, have you heard?'],
    casual: ['Oh, you\'ll like this.', 'Here\'s a nice one.'],
    old: ['Isn\'t it lovely, have you heard?'],
    kid: ['Guess what! It\'s good!'],
  },
  'news.open.self': {
    any: ['Guess what?', 'I\'ve got news.', 'I\'ve got something to tell you.', 'You\'ll never guess.', 'Did I tell you?'],
    casual: ['So, guess what.', 'Big news.', 'Right, news.'],
    formal: ['I have some news, actually.', 'I should tell you something.'],
    young: ['Okay, big news.', 'So, um. News.'],
  },
  'news.open.secret': {
    any: ['Don\'t tell anyone, but…', 'Keep this to yourself, but…', 'Between you and me…', 'This is just between us.', 'You didn\'t hear this from me.'],
    casual: ['Promise you won\'t tell?', 'Don\'t say I said, but…', 'Can you keep a secret?'],
    formal: ['I\'d rather this went no further, but…', 'In confidence…'],
    young: ['Okay, don\'t tell anyone.', 'You can\'t tell anyone. Seriously.'],
    old: ['Now, this mustn\'t go any further.'],
  },

  // ---- hedges: how sure, and how they know ---------------------------------------------------------------------
  'hedge.witnessed': { any: ['I saw it myself.', 'I was there.', 'I saw it with my own eyes.', 'Saw it myself.', 'I was right there.'] },
  'hedge.broadcast': { any: ['It was in the paper.', 'It\'s in the paper.', 'It\'s on the notice board.', 'It\'s all over town.', 'Everyone\'s talking about it.'] },
  'hedge.told': {
    any: ['{src} told me.', 'I heard it from {src_o}.', 'That\'s what {src} said.', '{src} was telling me.', 'According to {src_o}.', 'So {src} says.'],
    casual: ['{src} told me, anyway.', 'Got it from {src_o}.'],
    formal: ['{src} mentioned it.', 'I had it from {src_o}.'],
  },
  'hedge.unsure.pre': { any: ['Apparently', 'People are saying', 'Rumour has it', 'I don\'t know if it\'s true, but', 'I heard', 'Someone said', 'They say'] },
  'hedge.mid.pre': { any: ['Apparently', 'I heard', 'Seems', 'So it seems,', 'I hear'] },
  'hedge.unsure.post': { any: ['Or so they say.', 'Don\'t quote me.', 'If it\'s true.', 'That\'s what I heard, anyway.', 'Take it with a pinch of salt.'] },

  // ---- reactions -------------------------------------------------------------------------------------------------
  'react.tragic': {
    any: ['Oh no.', 'Oh, that\'s awful.', 'That\'s terrible.', 'I\'m so sorry to hear that.', 'Oh, how sad.', 'Oh. I didn\'t know.'],
    casual: ['Oh God, no.', 'No… really?', 'That\'s rotten.'],
    formal: ['How dreadful.', 'I\'m very sorry to hear it.', 'That is sad news indeed.'],
    young: ['Oh no. That\'s so sad.', 'Wait, seriously? That\'s awful.'],
    old: ['Oh, the poor soul.', 'Oh dear, oh dear.', 'God rest them.', 'We\'re none of us getting younger.'],
    kid: ['Oh no.', 'That\'s sad.'],
  },
  'react.sad': {
    any: ['Oh no, poor {who}.', 'Oh dear.', 'That\'s a shame.', 'Poor thing.', 'Oh, I hope {pro} {is} alright.', 'That\'s hard.'],
    casual: ['Ah, that\'s rough.', 'Oh no. Poor {who}.', 'That\'s rubbish.'],
    formal: ['I\'m sorry to hear that.', 'That\'s very unfortunate.', 'I do hope {pro} {is} alright.'],
    old: ['Oh dear. Poor love.', 'Oh, that\'s a shame. {Pro} {is} such a dear.'],
    young: ['Aw, no.', 'That sucks.'],
  },
  'react.bad': {
    any: ['Oh no.', 'That\'s a shame.', 'That\'s not good.', 'Oh dear.', 'What a shame.', 'Poor {who}.'],
    casual: ['Ah, that\'s rough.', 'That\'s rubbish.', 'Bad luck.', '{wow}. That\'s a blow.'],
    formal: ['That\'s unfortunate.', 'I\'m sorry to hear it.'],
    young: ['That sucks.', 'Oof.', 'Ugh, no.'],
    old: ['Times are hard.', 'Oh, it\'s not like it used to be.'],
  },
  'react.good': {
    any: ['Oh, that\'s lovely!', 'Oh, how nice.', 'That\'s wonderful.', 'Good for {who}!', 'Oh, I am pleased.', 'That\'s great news.'],
    casual: ['Ah, brilliant!', 'Nice one!', 'Oh, that\'s great.', 'About time!'],
    formal: ['How wonderful.', 'That is good news.', 'Please pass on my congratulations.'],
    young: ['Aw, cute!', 'No way, that\'s amazing!', 'Love that.', 'That\'s so nice.'],
    old: ['Oh, how lovely.', 'Isn\'t that nice.', 'Well, I never. Good for {who}.'],
    kid: ['Cool!', 'Yay!'],
  },
  'react.good.grudging': {
    any: ['Huh. Good for {who}, I suppose.', 'Well. Good luck to {pro_obj}.', 'Hm. If you say so.', 'Lucky {who}.'],
    casual: ['Right. Whatever.', 'Huh. Didn\'t see that coming.'],
  },
  'react.scandal.gossip': {
    any: ['No!', 'No! Really?', 'You\'re joking!', 'Get away!', 'I knew it!', 'Never!', 'Who\'d have thought?', 'Well, well, well.'],
    casual: ['{wow}! Really?', 'Shut up!', 'No way!', 'I knew there was something!', 'Oh, that\'s juicy.', 'Tell me everything.'],
    formal: ['Good heavens.', 'Goodness me!', 'Well, I never.'],
    young: ['No way!', 'Shut up! Seriously?', 'Oh my God.', 'Stop it. Really?', 'That\'s wild.'],
    old: ['Well, I never!', 'Goodness gracious!', 'In my day…'],
    kid: ['Whoa!', 'Really?'],
  },
  'react.scandal.prim': {
    any: ['That\'s none of our business, really.', 'Well, that\'s not very nice.', 'I\'d rather not know.', 'Hm. People should mind their own business.', 'That\'s their affair.'],
    formal: ['I don\'t think we should be talking about this.', 'That\'s hardly our concern.', 'How unfortunate for everyone.'],
    old: ['Disgraceful.', 'In my day we didn\'t talk about such things.'],
  },
  'react.sceptic': {
    any: ['Really? I\'m not sure about that.', 'Hm. I\'ll believe it when I see it.', 'Are you sure?', 'That doesn\'t sound right.', 'I doubt it.', 'Says who?'],
    casual: ['Pull the other one.', 'Yeah, right.', 'Come off it.', 'Nah, can\'t be.'],
    formal: ['I find that hard to believe.', 'Are you quite sure?', 'I\'d want to hear that from someone else.'],
    young: ['Yeah, sure.', 'Is that even true?', 'Who told you that?'],
    old: ['People will say anything these days.', 'I\'ll believe it when I see it.'],
  },
  'react.crime': {
    any: ['That\'s awful.', 'In this town?', 'Oh no. Is everyone alright?', 'Shocking.', 'You\'re not safe anywhere these days.', 'Did they call the police?'],
    casual: ['{wow}. Here?', 'That\'s scary.', 'I\'m locking my door tonight.'],
    old: ['It was never like this before.', 'What is the world coming to?'],
    young: ['That\'s so creepy.', 'Wait, here?'],
  },
  'react.news': {
    any: ['Oh, really?', 'Is that right?', 'I didn\'t know that.', 'Huh.', 'Well, there you go.', 'Oh, I see.', 'Fancy that.'],
    casual: ['Oh yeah?', 'Huh. Interesting.', 'No kidding.', 'Right.'],
    formal: ['Is that so?', 'How interesting.', 'I hadn\'t heard.'],
    young: ['Oh, okay.', 'Huh, cool.', 'Wait, really?'],
    old: ['Well, I never.', 'Is that so? Fancy.'],
  },
  'react.politics': {
    any: ['About time.', 'We\'ll see.', 'Politicians.', 'Well, someone has to do it.', 'Is that right?', 'That\'ll go down well.'],
    casual: ['Oh, great. Here we go.', 'Typical.', 'Can\'t be worse than the last lot.'],
    formal: ['I\'ll be interested to see how that goes.', 'That\'s worth keeping an eye on.'],
    old: ['They\'re all the same.', 'In my day the council actually did things.'],
  },
  'react.event': {
    any: ['Oh, nice.', 'Is it? I\'ll have to go.', 'Thanks for telling me.', 'I\'ll put it in the diary.', 'Might go to that.'],
    casual: ['Oh, cool.', 'Might pop along.'],
  },
  'react.family.bad': {
    any: ['That\'s my {tie} you\'re talking about.', 'I know. It\'s been hard on all of us.', 'Yes. We\'re all a bit shaken.', 'I know. Please don\'t spread it around.'],
    casual: ['Yeah. Don\'t remind me.', 'I know. It\'s rough.'],
  },
  'react.family.scandal': {
    any: ['That\'s my {tie} you\'re talking about!', 'Who\'s been saying that?', 'That\'s not true. Who told you that?', 'You shouldn\'t listen to gossip.', 'Leave my {tie} out of it.'],
    casual: ['Oi. That\'s my {tie}.', 'Watch it. That\'s family.'],
  },
  'react.family.good': {
    any: ['I know! We\'re so pleased.', 'Isn\'t it great? We\'re all thrilled.', 'I know, we\'re very proud.', 'Yes! Lovely, isn\'t it?'],
  },
  'react.knew': {
    any: ['I know, I heard.', 'Yes, I\'d heard.', 'Old news, I\'m afraid.', 'So I hear.', 'Yes, I heard.'],
    casual: ['Yeah, I know.', 'Heard that already.'],
  },
  'react.self': {
    any: ['Oh, that\'s wonderful!', 'Congratulations!', 'Oh, I\'m so sorry.', 'How are you holding up?'],
  },
  'react.self.good': { any: ['Congratulations!', 'Oh, that\'s wonderful news!', 'Well done, you!', 'Oh, I\'m so happy for you.', 'Brilliant!'] },
  'react.self.bad': { any: ['Oh, I\'m so sorry.', 'Oh no. How are you holding up?', 'That\'s awful. If there\'s anything I can do…', 'I\'m sorry. That must be hard.'] },

  // ---- follow-ups ------------------------------------------------------------------------------------------------
  'ask.source': { any: ['Who told you that?', 'Where did you hear that?', 'Says who?', 'Who said?', 'Where\'s that from?'] },
  'answer.source': { any: ['{src} did.', 'I heard it from {src_o}.', '{src} told me.', 'Ask {src_o}.'], casual: ['{src} did. Don\'t tell {src_o} I said.'] },
  'answer.source.vague': { any: ['Oh, people are talking.', 'Just something I heard.', 'Everyone\'s saying it.', 'I can\'t remember now.'] },
  'answer.source.self': { any: ['{Pro} told me {self}.', 'From the horse\'s mouth: {pro} told me {self}.', '{Pro} said so {self}.'] },
  'answer.witnessed': { any: ['I saw it myself.', 'I was there!', 'With my own eyes.'] },
  'disagree': {
    any: ['That\'s not what I heard.', 'No, I heard it differently.', 'Really? That\'s not how I heard it.', 'Hang on, that\'s not right.'],
    casual: ['Nah, that\'s not it.', 'No, no, no.'],
    formal: ['I believe you\'re mistaken.', 'I heard something rather different.'],
  },
  'disagree.worse': { any: ['I heard it was worse than that.', 'Worse, the way I heard it.', 'It\'s worse than that, I heard.', 'That\'s putting it mildly, from what I heard.'] },
  'disagree.milder': { any: ['I heard it wasn\'t as bad as all that.', 'It\'s not that bad, from what I heard.', 'People do exaggerate.', 'I think someone\'s blown it up a bit.'] },
  'disagree.mine': { any: ['I heard {fact}.', 'The way I heard it, {fact}.', '{src} told me {fact}.', 'What I heard is {fact}.'] },
  'disagree.back': {
    any: ['Well, that\'s what I was told.', 'Maybe. That\'s what I heard.', 'Who knows, then.', 'Hm. One of us is wrong.', 'Well, someone\'s got it wrong.'],
    casual: ['Whatever, that\'s what I heard.'],
  },
  'secret.close': { any: ['Don\'t tell anyone I told you.', 'Keep it to yourself.', 'Not a word, mind.', 'You didn\'t hear it from me.'] },
  'secret.reply': { any: ['My lips are sealed.', 'I won\'t say a word.', 'Of course.', 'Who would I tell?'] },
  'tag.embellish': {
    any: ['And that\'s not all.', 'And it\'s serious.', 'Properly, too.', 'The whole street knows.', 'It\'s worse than it sounds.'],
    casual: ['And I mean properly.', 'Big time.'],
  },

  // ---- small talk ------------------------------------------------------------------------------------------------
  'weather.rain': {
    any: ['Awful weather.', 'Wet enough for you?', 'It\'s not stopping, is it?', 'Raining again.', 'Lovely weather for ducks.', 'Did you bring an umbrella?'],
    casual: ['Chucking it down, isn\'t it?', 'Typical. Rain again.', 'I\'m soaked.', 'Proper wet out there.'],
    old: ['It\'s good for the gardens, I suppose.', 'My knees knew it would rain.'],
    young: ['Ugh, this rain.', 'I\'m drenched.'],
  },
  'weather.drizzle': { any: ['Bit drizzly.', 'This drizzle gets everywhere.', 'Can\'t decide if it\'s raining or not.', 'Damp old day.'] },
  'weather.storm': { any: ['What a storm!', 'Did you hear the thunder?', 'Wild out there.', 'Best stay in today.', 'The lights flickered at ours.'] },
  'weather.snow': {
    any: ['Look at all this snow!', 'Snow again.', 'Mind how you go, it\'s slippery.', 'Did you get your car out?', 'Proper winter, this.'],
    kid: ['It\'s snowing!', 'Can we build a snowman?', 'Snowball fight!'],
    old: ['Careful on the ice, at our age.', 'Winters were worse when I was young.'],
    young: ['Snow day?', 'So much snow!'],
  },
  'weather.ice': { any: ['Mind the ice.', 'It\'s like a skating rink out there.', 'Nearly went over on the path.'] },
  'weather.cold': {
    any: ['Cold today.', 'Bitter out, isn\'t it?', 'Freezing, isn\'t it?', 'Wrap up warm.', 'There\'s a nip in the air.'],
    casual: ['Brass monkeys out there.', 'It\'s perishing.', 'I can\'t feel my fingers.'],
    old: ['It goes right through you.', 'This cold gets into my bones.'],
  },
  'weather.hot': {
    any: ['Hot enough for you?', 'Isn\'t it hot?', 'What a scorcher.', 'Too hot for me.', 'Make sure you drink plenty.'],
    casual: ['I\'m melting.', 'Boiling, isn\'t it?'],
    young: ['It\'s so hot.', 'Ice cream weather!'],
    kid: ['Can we go swimming?', 'It\'s so hot!'],
  },
  'weather.nice': {
    any: ['Lovely day, isn\'t it?', 'Beautiful day.', 'Gorgeous out.', 'Nice to see the sun.', 'Isn\'t it a lovely {todl}?', 'Days like this make it all worth it.'],
    casual: ['Cracking day.', 'Proper nice out.'],
    old: ['Lovely day for it.', 'You can\'t beat a day like this.'],
  },
  'weather.fog': { any: ['Foggy this {todl}.', 'Can hardly see across the road.', 'Pea-souper today.', 'This fog!'] },
  'weather.grey': { any: ['Grey old day.', 'Dull, isn\'t it?', 'Bit miserable out.', 'Could do with some sun.', 'Not much of a day.', 'Grey again.', 'Can\'t remember the last time I saw the sun.', 'Gloomy, isn\'t it?', 'Bit grey today.'] },
  'weather.windy': { any: ['Windy, isn\'t it?', 'Nearly blew away.', 'Hold on to your hat.', 'Blowing a gale out there.'] },
  'weather.mild': { any: ['Not a bad day.', 'Not bad out, is it?', 'Pleasant enough today.', 'Nice enough day.', 'Can\'t complain about the weather.', 'Decent day for it.', 'Not too bad out there.', '[Fairly|Quite] mild today.', 'Bit of sun, at least.'] },
  'weather.reply.agree': {
    any: ['Isn\'t it.', 'I know.', 'Tell me about it.', 'You\'re not wrong.', 'Mm, it is.'],
    casual: ['Yeah, I know.', 'Right?', 'Don\'t get me started.'],
    formal: ['Quite.', 'Indeed it is.', 'It certainly is.'],
    old: ['It is, it is.', 'Never seen the like.'],
  },
  'weather.reply.nice': {
    any: ['Isn\'t it.', 'Lovely.', 'Makes a change.', 'Long may it last.', 'Not bad at all.', 'Mm, nice.', 'I\'ll take it.', 'It is, isn\'t it?'],
    casual: ['Can\'t complain.', 'Yeah, nice.'],
    formal: ['Very pleasant.', 'It is indeed.'],
  },
  'weather.reply.bright': { any: ['Could be worse.', 'Still, it\'ll pass.', 'Makes a change.', 'Good for the gardens.', 'Better than last week.'] },
  'weather.forecast': { any: ['Supposed to stay like this all week.', 'They say it\'ll change tomorrow.', 'Make the most of it.', 'Won\'t last.'] },
  'occasion.ask': {
    any: ['Are you going to {occ} {when}?', 'Going to {occ} {when}?', 'Will we see you at {occ} {when}?', 'You coming to {occ} {when}?'],
    formal: ['Will you be at {occ} {when}?'],
  },
  'occasion.say': { any: ['{Occ} is {when}, isn\'t it?', 'Don\'t forget {occ} {when}.', 'It\'s {occ} {when}.', 'Big day {when}: {occ}.'] },
  'occasion.say.reply': { any: ['Oh, is it?', 'Thanks for reminding me.', 'I know, I can\'t wait.', 'Already in the diary.', 'Oh, I\'d forgotten.', 'So it is.'] },
  'occasion.yes': { any: ['Wouldn\'t miss it.', 'Yes, I\'ll be there.', 'I think so.', 'Of course.', 'If I can get away.'] },
  'occasion.no': { any: ['Not this time.', 'Can\'t, I\'m afraid.', 'Probably not.', 'Not really my thing.', 'We\'ll see.'] },
  'occasion.sad': { any: ['Are you going to {occ} {when}?', 'It\'s {occ} {when}.', 'I suppose you\'ll be at {occ} {when}.'] },
  'occasion.sad.reply': { any: ['Yes. Have to pay my respects.', 'I will. Such a shame.', 'Yes. It\'ll be a sad day.', 'I think so.'] },
  'holiday.christmas': { any: ['Merry Christmas!', 'Happy Christmas!', 'Merry Christmas to you and yours.'] },
  'holiday.christmasEve': { any: ['All ready for tomorrow?', 'Got all your presents?', 'Nearly Christmas!'], kid: ['Is it Christmas yet?', 'Santa comes tonight!'] },
  'holiday.newYear': { any: ['Happy New Year!', 'All the best for the new year!'] },
  'holiday.newYearsEve': { any: ['Doing anything tonight?', 'Last day of the year!', 'Going to see the fireworks?'] },
  'holiday.easter': { any: ['Happy Easter!', 'Lovely Easter weekend.'], kid: ['I found five eggs!'] },
  'holiday.halloween': { any: ['Got your sweets in for tonight?', 'Ready for the trick-or-treaters?'], kid: ['Trick or treat!', 'I\'m going as a ghost!'] },
  'holiday.summerFestival': { any: ['Going to the festival?', 'The festival\'s on!', 'Have you been down to the festival yet?'] },
  'holiday.christmasMarket': { any: ['Been to the Christmas market yet?', 'The Christmas market\'s on.', 'Smell that mulled wine.'] },
  'holiday.reply': { any: ['And to you!', 'You too!', 'Same to you!', 'Thank you, and you.'] },
  'lore': {
    any: ['You know, {lore}.', 'Did you know {lore}?', 'Funny thing, {lore}.', 'Someone told me {lore}.', 'Here\'s a thing: {lore}.', 'They say {lore}.'],
    old: ['When I was young, they used to say {lore}.', 'My father used to say {lore}.', 'Everyone knows {lore}.'],
    young: ['Apparently {lore}.', 'Fun fact: {lore}.'],
  },
  'lore.reply': { any: ['Is that right?', 'So they say.', 'I didn\'t know that.', 'Everyone knows that!', 'Huh, really?', 'I\'ve heard that.'] },
  'tired': {
    any: ['I\'m worn out.', 'Long day.', 'I could sleep for a week.', 'I\'m dead on my feet.'],
    casual: ['I\'m shattered.', 'Knackered, me.'],
    young: ['So tired.', 'Need sleep.'],
    old: ['These old bones need a rest.'],
  },
  'tired.reply': { any: ['Get an early night.', 'Me too.', 'Go home and put your feet up.', 'You look it.', 'I know the feeling.'] },
  'hungry': { any: ['I\'m starving.', 'Could eat a horse.', 'I haven\'t eaten all day.', 'Is it lunchtime yet?'] },
  'hungry.reply': { any: ['Me too.', 'Go and get something.', 'The bakery\'s still open.', 'You should eat something.'] },
  'work.ask': { any: ['Busy at {work}?', 'How\'s work?', 'Still at {work}?', 'Keeping busy?', 'How are things at {work}?'] },
  'work.reply': {
    any: ['Never stops.', 'Busy, busy.', 'Quiet, actually.', 'Can\'t complain.', 'Same as ever.', 'Mad. Don\'t ask.', 'Could be worse.'],
    casual: ['Don\'t talk to me about work.', 'It pays the bills.'],
    young: ['It\'s fine. Boring.', 'Ugh. Don\'t ask.'],
  },
  'school.ask': { any: ['How\'s school?', 'Learning lots?', 'Homework done?'] },
  'school.reply': { any: ['Fine.', 'Boring.', 'Okay.', 'We had a test.', 'It\'s alright.'], young: ['Ugh. Fine.', 'Don\'t ask.'] },
  'family.ask': { any: ['How\'s {kin}?', 'How\'s {kin} doing?', 'And how\'s {kin}?', 'Give my love to {kin}.', 'Is {kin} keeping well?'] },
  'family.reply': {
    any: ['{Pro} {is} fine, thanks.', '{Pro} {is} doing well.', 'Oh, you know. Up and down.', 'Same as ever.', 'Very well, thank you.', 'Keeping busy.'],
    casual: ['Yeah, good, thanks.', 'Still alive!'],
  },
  'family.reply.ill': { any: ['Not so good, to be honest.', '{Pro} {is} poorly, actually.', 'We\'re worried, to be honest.'] },
  'mood.low': {
    any: ['Not a great day, to be honest.', 'Oh, I\'ve been better.', 'Bit down today.', 'One of those days.'],
    young: ['Ugh, today.', 'I\'m so done with today.'],
    old: ['Mustn\'t grumble. But I will.'],
  },
  'mood.low.reply': { any: ['Oh no. Chin up.', 'It\'ll get better.', 'Sorry to hear that.', 'Anything I can do?', 'Hang in there.'] },
  'mood.high': { any: ['I\'m in a good mood today.', 'Feeling good today.', 'What a day!', 'Everything\'s going right for once.'] },
  'mood.high.reply': { any: ['Good for you!', 'Glad to hear it.', 'Long may it last.', 'What\'s got into you?'] },
  'place.pub': { any: ['Same again?', 'What are you having?', 'My round.', 'Quiet in here tonight.', 'Busy in here.', 'Good pint, this.'] },
  'place.pub.reply': { any: ['Go on, then.', 'Just a half.', 'Cheers.', 'Not for me, I\'m driving.', 'Lovely.'] },
  'place.cafe': { any: ['The coffee\'s good here.', 'Have you tried the cake?', 'Busy in here today.', 'Nice and warm in here.'] },
  'place.bakery': { any: ['They\'ve sold out of rolls again.', 'Smells lovely in here.', 'Long queue today.', 'Always a queue in here.'] },
  'place.shop': { any: ['Prices keep going up.', 'They\'ve moved everything again.', 'Long queue today.', 'Have they got any bread left?'] },
  'place.church': { any: ['Nice service.', 'Good turnout today.', 'Lovely hymns.', 'The vicar was on form.'] },
  'place.park': { any: ['Lovely spot, this.', 'Nice for a walk.', 'Look at the ducks.', 'Busy in the park today.'] },
  'place.school': { any: ['Have you seen the homework they set?', 'Big test this week.', 'Do you know when the break is?'], kid: ['Want to play?', 'Tag! You\'re it!'] },
  'place.doctor': { any: ['Always a wait in here.', 'Been waiting ages.', 'Nothing serious, I hope?'] },
  'place.reply': { any: ['Mm.', 'Isn\'t it.', 'I know.', 'Too right.', 'True.', 'You\'re telling me.'] },

  // ---- endings ---------------------------------------------------------------------------------------------------
  'part': {
    any: ['See you.', 'Take care.', 'Bye then.', 'See you later.', 'Must dash.', 'Mind how you go.', 'Right, I\'d better be off.'],
    casual: ['See ya.', 'Laters.', 'Cheers, then.', 'Catch you later.', 'Right, I\'m off.'],
    formal: ['Good {todl} to you.', 'Do take care.', 'Lovely to see you.', 'Give my regards to the family.'],
    young: ['See ya.', 'Bye!', 'Later.', 'Text me.'],
    old: ['Look after yourself.', 'Don\'t be a stranger.', 'Lovely to see you, dear.'],
    kid: ['Bye!', 'See you tomorrow!'],
  },
  'part.night': { any: ['Night.', 'Goodnight.', 'Sleep well.', 'Night, then.'] },
  'part.reply': { any: ['Bye.', 'See you.', 'You too.', 'Take care.', 'Bye now.', 'Cheers.'], young: ['Bye.', 'Later.'] },
  'snub': {
    any: ['Sorry, I have to go.', 'Can\'t stop.', 'Not now.', 'I\'m in a hurry.', 'Excuse me.'],
    casual: ['Got to go.', 'Not today.'],
  },
  'snub.reply': { any: ['Charming.', 'Well!', 'Suit yourself.', 'Fine.', 'What did I do?'] },
  'animal.own.dog': { any: ['Good {boy}!', 'Who\'s a good {boy}?', 'Come on, {pet}!', 'Leave it, {pet}.', 'Heel, {pet}.', 'Walkies!', 'Sit, {pet}. Good.'] },
  'animal.own.cat': { any: ['Hello, {pet}.', 'There you are, {pet}.', 'Are you hungry, {pet}?', 'Off the table, {pet}!', 'Who\'s purring?'] },
  'animal.dog': { any: ['Hello, {boy}.', 'Aren\'t you lovely?', 'Hello there, doggy.', 'Can I stroke {it}?', 'Off you go.', 'Good dog.'], kid: ['Doggy!', 'Can I pet {it}?'] },
  'animal.cat': { any: ['Hello, puss.', 'Here, kitty.', 'Aren\'t you pretty?', 'Psst, puss puss.'], kid: ['Kitty!'] },
  'animal.farm': { any: ['Come on, then.', 'Steady.', 'There you go.', 'Easy, now.', 'Hup, hup!'] },
  'animal.wild': { any: ['Oh, look!', 'Did you see that?', 'Look, a {species}!', 'Shh, you\'ll scare it.'] },
} as const satisfies Record<string, Bank>;

export type ActName = keyof typeof ACTS;
