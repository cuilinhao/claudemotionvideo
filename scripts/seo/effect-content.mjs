// Prompts copied verbatim from reference/pages/effects/index.html.
// Community media and local posters come from public/reference-assets/data/
// examples.json and example-media.json. These are original creators' X videos.
// Original post publication timestamps were verified on 2026-10-18 using
// https://api.fxtwitter.com/2/status/{id}, status.created_at / created_timestamp.
// This is also the media map's documented provenance in the asset manifest.
// Video associations are editorial references, not source-defined effect demos;
// the original effects-library canvas is the definitive effect demonstration.

const stephan = {
  id: '2103315922098470926',
  contentUrl: 'https://video.twimg.com/amplify_video/2103315748496302080/vid/avc1/1280x720/eCO2uc133COVHpCg.mp4?tag=29',
  thumbnailUrl: '/reference-assets/external/pbs.twimg.com/amplify_video_thumb/2103315748496302080/img/eScXkusmi5doSQFo.jpg',
  uploadDate: '2026-09-25T02:49:28Z',
  author: 'Stephan Livera (@stephanlivera)',
  sourceUrl: 'https://x.com/stephanlivera/status/2103315922098470926',
};

const develop = {
  id: '2103835273813496100',
  contentUrl: 'https://video.twimg.com/amplify_video/2103830256347910144/vid/avc1/720x720/5ECca-LUMDVtwt7a.mp4?tag=29',
  thumbnailUrl: '/reference-assets/external/pbs.twimg.com/amplify_video_thumb/2103830256347910144/img/YsUzKmE5XqGD9NZR.jpg',
  uploadDate: '2026-09-26T13:13:11Z',
  author: 'zero (@twoclipping)',
  sourceUrl: 'https://x.com/twoclipping/status/2103835273813496100',
};

const techhalla = {
  id: '2103411244468498547',
  contentUrl: 'https://video.twimg.com/amplify_video/2103409564657885184/vid/avc1/720x720/sRUCrID2I-a6mKxe.mp4?tag=29',
  thumbnailUrl: '/reference-assets/external/pbs.twimg.com/amplify_video_thumb/2103409564657885184/img/yzB3EAzZHx4veQ_X.jpg',
  uploadDate: '2026-09-25T09:08:14Z',
  author: 'TechHalla (@techhalla)',
  sourceUrl: 'https://x.com/techhalla/status/2103411244468498547',
};

const kenn = {
  id: '2103337314021937232',
  contentUrl: 'https://video.twimg.com/amplify_video/2103336752341745664/vid/avc1/1280x720/1SLt_8u7Rd6I_ISG.mp4?tag=29',
  thumbnailUrl: '/reference-assets/external/pbs.twimg.com/amplify_video_thumb/2103336752341745664/img/uqGesaw3Xjtod1AE.jpg',
  uploadDate: '2026-09-25T04:14:28Z',
  author: 'Kenn Ejima (@kenn)',
  sourceUrl: 'https://x.com/kenn/status/2103337314021937232',
};

const gadgetify = {
  id: '2103458245213929495',
  contentUrl: 'https://video.twimg.com/amplify_video/2103442907357233152/vid/avc1/720x720/vG5fMri0xlous-L1.mp4?tag=29',
  thumbnailUrl: '/reference-assets/external/pbs.twimg.com/amplify_video_thumb/2103442907357233152/img/Yob1ZkvwuXtjuzFW.jpg',
  uploadDate: '2026-09-25T12:15:00Z',
  author: 'Gadgetify (@Gdgtify)',
  sourceUrl: 'https://x.com/Gdgtify/status/2103458245213929495',
};

export const effectContent = [
  {
    slug: 'letter-drop-animation',
    description: 'Letter drop introduces a headline one character at a time. Each letter starts above its final position, falls into place, overshoots slightly, and settles with a small bounce. The stagger creates a readable rhythm for short titles, product names, and showreel openings. Use the library preview to inspect the motion, then copy the original effect wording into a prompt with your own text.',
    prompt: 'letters drop in one by one from above with a slight overshoot bounce',
    example: {
      ...stephan,
      caption: 'Community example by Stephan Livera: around 12 seconds, the letters in NEVER arrive from above in sequence. The full showreel combines this moment with several other motion techniques.',
    },
  },
  {
    slug: 'masked-rise-animation',
    description: 'Masked rise reveals letters as they move upward through an invisible baseline. The hidden portion stays clipped until it crosses that line, giving the entrance a clean edge. A short stagger lets the word build progressively. This library effect suits restrained product titles, captions, and section headings. Keep enough room above the baseline for the finished text, and use the preview to judge its rhythm.',
    prompt: 'each letter rises from behind a hidden baseline mask, staggered',
    example: {
      ...develop,
      caption: 'Community example by zero (@twoclipping): the develop launch film uses connected product and text reveals. Its published prompt explicitly asks for text that rises out of a mask line; the library preview isolates the letter effect.',
    },
  },
  {
    slug: 'typewriter-cursor-animation',
    description: 'Typewriter cursor reveals a line character by character in a monospace font, with a blinking block cursor marking the typing sequence. The changing text provides a natural point of attention for short taglines, terminal introductions, and message reveals. The library preview shows the specific effect. Choose a concise line and allow a final pause so viewers can read the complete message after typing ends.',
    prompt: 'the line types out character by character in a monospace font with a blinking block cursor',
    example: {
      ...techhalla,
      caption: 'Related community example by TechHalla: near the end, @TECHHALLA appears progressively beside a magenta cursor. This variation uses a different font and cursor position; the library preview demonstrates the requested monospace block-cursor effect.',
    },
  },
  {
    slug: 'stretch-slide-in-animation',
    description: 'Stretch slide-in brings a word into the frame from the right while its letters appear wider than their resting proportions. As the movement slows, the word snaps back to its normal width. The result gives a short headline a clear sense of speed and arrival. This library preview demonstrates the entrance; use compact text and leave horizontal space for the stretched shape to travel.',
    prompt: 'the word slides in from the right stretched wide and snaps to its normal width',
    example: {
      ...stephan,
      caption: 'Related community example by Stephan Livera: the CLAUDE title changes character width around 2–3 seconds. It illustrates elastic typography, while the library preview demonstrates the specific slide from the right and return to normal width.',
    },
  },
  {
    slug: 'squash-and-stretch-animation',
    description: 'Squash and stretch makes a word behave like a physical object. It falls from above, compresses when it lands, and springs back before settling into its readable shape. The changing proportions communicate weight through motion alone. This library effect works with brief, bold titles that can tolerate temporary distortion. Watch the preview to see the landing, then reuse the original wording with your own headline.',
    prompt: 'the word falls from above, squashes on impact and springs back like a heavy object landing',
    example: {
      ...gadgetify,
      caption: 'Related community example by Gadgetify: BUILD THE FLOOR treats words such as WAITING and VOICE as physical parts of the scene. It explores weight and moving type; the library preview demonstrates the precise falling, squashing, and rebound sequence.',
    },
  },
  {
    slug: 'outline-echo-effect',
    description: 'Outline echo places expanding outlined copies behind a solid word. The repeated contours spread outward while the filled text remains the visual anchor, adding depth without replacing the headline. In the library preview, this creates a ripple around the word. Try it with a short title and a clear contrast between text and background so the overlapping outlines stay distinct as they expand.',
    prompt: 'outlined copies of the word expand outward like ripples behind the solid word',
    example: {
      ...kenn,
      caption: 'Related community example by Kenn Ejima: around 4 seconds, DECISION expands into a field of repeated outlined and solid words. This broader typography composition shows outline repetition; the library preview isolates the outward ripple effect.',
    },
  },
  {
    slug: 'decode-scramble-text-effect',
    description: 'Decode scramble begins with unstable characters and progressively resolves them into a readable word from left to right. The flickering glyphs create a brief moment of uncertainty before the final text locks into place. This library effect is useful for short technology titles and reveal moments. Keep the finished phrase concise and give it enough time on screen after the scrambling stops.',
    prompt: 'the word resolves from random flickering glyphs into the final text, left to right',
    example: {
      ...techhalla,
      caption: 'Community example by TechHalla: around 3–4 seconds, green scrambled letters and numbers resolve into EXPENSIVE. The full identity bumper mixes this text treatment with other animated typography; the library preview isolates the decode effect.',
    },
  },
  {
    slug: 'skewed-wipe-transition',
    description: 'Skewed wipe moves a slanted colour bar across the entire frame to cover the change between two scenes. Its diagonal edge adds direction to a fast transition while the full screen coverage hides the cut. The library preview shows the specific wipe. Use it between clearly different compositions, and choose a transition colour that belongs to the surrounding scenes or your visual palette.',
    prompt: 'cut between scenes with a fast skewed full-screen colour wipe',
    example: {
      ...stephan,
      caption: 'Related community example by Stephan Livera: the showreel moves between contrasting full-screen scenes and colour fields. It provides broader transition context; the specific slanted colour-bar wipe is demonstrated by the library preview, not established by this video.',
    },
  },
];
