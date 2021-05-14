import { EventEmitter } from 'events'
import dedent from 'dedent'
import rehypeParse from 'rehype-parse'
import remarkParse from 'remark-parse'
import TypedEmitter from 'typed-emitter'
import unified from 'unified'
import { visit } from 'unist-util-visit'
import { MarkdownString, Range, TextDocument } from 'vscode'
import yaml from 'yaml'
import { Pair, YAMLMap } from 'yaml/types'
import { frontMatterRegex } from './utils'

const parseHtml = unified().use(rehypeParse).parse
const parseMd = unified().use(remarkParse).parse
const parseYaml = (yamlBody: string) =>
  yaml.parseDocument(yamlBody, { schema: 'failsafe' })

export enum DirectiveType {
  Global = 'Global',
  Local = 'Local',
}

export enum DirectiveDefinedIn {
  FrontMatter = 'frontMatter',
  Comment = 'comment',
}

const directiveAlwaysAllowed = [
  DirectiveDefinedIn.FrontMatter,
  DirectiveDefinedIn.Comment,
] as const

export enum DirectiveProvidedBy {
  Marpit = 'Marpit framework',
  MarpCore = 'Marp Core',
  MarpCLI = 'Marp CLI',
  MarpVSCode = 'Marp for VS Code',
}

interface DirectiveInfoBase {
  allowed: readonly DirectiveDefinedIn[]
  description: string
  details?: string
  markdownDescription: MarkdownString
  markdownDetails: MarkdownString
  name: string
  providedBy: DirectiveProvidedBy
  type: DirectiveType
}

type GlobalDirectiveInfo = DirectiveInfoBase & {
  scoped?: never
  type: DirectiveType.Global
}

type LocalDirectiveInfo = DirectiveInfoBase & {
  scoped?: boolean
  type: DirectiveType.Local
}

export type DirectiveInfo = GlobalDirectiveInfo | LocalDirectiveInfo

const createDirectiveInfo = (
  info:
    | Omit<GlobalDirectiveInfo, 'markdownDescription' | 'markdownDetails'>
    | Omit<LocalDirectiveInfo, 'markdownDescription' | 'markdownDetails'>
): Readonly<DirectiveInfo> => {
  const directiveText = `\`${info.name}\` [${
    info.type
  } directive](https://marpit.marp.app/directives?id=${info.type.toLowerCase()}-directives)${
    info.scoped ? ' _[Scoped]_' : ''
  }`

  const mdDetails = `_Provided by ${info.providedBy}${
    info.details ? ` ([Show more details...](${info.details}))` : ''
  }_`

  return Object.freeze({
    ...info,
    markdownDetails: new MarkdownString(mdDetails),
    markdownDescription: new MarkdownString(
      [directiveText, info.description, mdDetails].join('\n\n---\n\n'),
      true
    ),
  })
}

export interface DirectiveEventHandler {
  info?: DirectiveInfo
  item: Pair
  offset: number
}

export interface DirectiveSectionEventHandler {
  body: string
  range: Range
}

interface DirectiveParserEvents {
  comment: (event: DirectiveSectionEventHandler) => void
  directive: (event: DirectiveEventHandler) => void
  endParse: (event: { document: TextDocument }) => void
  frontMatter: (event: DirectiveSectionEventHandler) => void
  startParse: (event: { document: TextDocument }) => void
}

export class DirectiveParser extends (EventEmitter as new () => TypedEmitter<DirectiveParserEvents>) {
  static builtinDirectives: readonly Readonly<DirectiveInfo>[] = [
    // Marp for VS Code
    createDirectiveInfo({
      name: 'marp',
      description:
        'Set whether or not enable Marp preview in VS Code extension.',
      allowed: [DirectiveDefinedIn.FrontMatter],
      providedBy: DirectiveProvidedBy.MarpVSCode,
      type: DirectiveType.Global,
      details: 'https://github.com/marp-team/marp-vscode#usage',
    }),

    // Marpit global directives
    createDirectiveInfo({
      name: 'theme',
      description: dedent(`
        Specify a theme name of the slide deck.

        ## [Marp Core built-in themes](https://github.com/marp-team/marp-core/tree/main/themes)

        ### \`default\`

        ![](https://user-images.githubusercontent.com/3993388/48039490-53be1b80-e1b8-11e8-8179-0e6c11d285e2.png)

        ### \`gaia\`

        ![](https://user-images.githubusercontent.com/3993388/48039493-5456b200-e1b8-11e8-9c49-dd5d66d76c0d.png)

        ### \`uncover\`

        ![](https://user-images.githubusercontent.com/3993388/48039495-5456b200-e1b8-11e8-8c82-ca7f7842b34d.png)
      `),
      allowed: directiveAlwaysAllowed,
      providedBy: DirectiveProvidedBy.Marpit,
      type: DirectiveType.Global,
      details: 'https://marpit.marp.app/directives?id=theme',
    }),
    createDirectiveInfo({
      name: 'style',
      description: dedent(`
        Specify CSS for tweaking theme.

        It is exactly same as defining inline style within Markdown. Useful if \`<style>\` would break the view in the other Markdown tools.

        \`\`\`yaml
        style: |
          section {
            background-color: #123;
            color: #def;
          }
        \`\`\`
      `),
      allowed: directiveAlwaysAllowed,
      providedBy: DirectiveProvidedBy.Marpit,
      type: DirectiveType.Global,
      details: 'https://marpit.marp.app/directives?id=tweak-theme-style',
    }),
    createDirectiveInfo({
      name: 'headingDivider',
      description: dedent(`
        Specify heading divider option.

        You may instruct to divide slide pages at before of headings automatically. It is useful for making slide from existing Markdown document.

        It have to specify heading level from 1 to 6, or array of them. This feature is enabled at headings having the level _higher than or equal to the specified value_ if in a number, and it is enabled at _only specified levels_ if in array.

        \`\`\`yaml
        # Divide pages by headings having level 3 and higher (#, ##, ###)
        headingDivider: 3

        # Divide pages by only headings having level 1 and 3 (#, ###)
        headingDivider: [1, 3]
        \`\`\`
      `),
      allowed: directiveAlwaysAllowed,
      providedBy: DirectiveProvidedBy.Marpit,
      type: DirectiveType.Global,
      details: 'https://marpit.marp.app/directives?id=heading-divider',
    }),

    // Marpit local directives
    createDirectiveInfo({
      name: 'paginate',
      description: 'Show page number on the slide if set `true`.',
      allowed: directiveAlwaysAllowed,
      providedBy: DirectiveProvidedBy.Marpit,
      type: DirectiveType.Local,
      details: 'https://marpit.marp.app/directives?id=pagination',
    }),
    createDirectiveInfo({
      name: 'header',
      description: dedent(`
        Specify the content of slide header.

        The content of header can use basic Markdown formatting. To prevent the broken parsing by YAML special characters, recommend to wrap by quotes \`"\` or \`'\` when used Markdown syntax:

        \`\`\`yaml
        header: "**Header content**"
        \`\`\`

        To clear the header content in the middle of slides, set an empty string:

        \`\`\`yaml
        header: ""
        \`\`\`
      `),
      allowed: directiveAlwaysAllowed,
      providedBy: DirectiveProvidedBy.Marpit,
      type: DirectiveType.Local,
      details: 'https://marpit.marp.app/directives?id=header-and-footer',
    }),
    createDirectiveInfo({
      name: 'footer',
      description: dedent(`
        Specify the content of slide footer.

        The content of footer can use basic Markdown formatting. To prevent the broken parsing by YAML special characters, recommend to wrap by quotes \`"\` or \`'\` when used Markdown syntax:

        \`\`\`yaml
        footer: "**Footer content**"
        \`\`\`

        To clear the footer content in the middle of slides, set an empty string:

        \`\`\`yaml
        footer: ""
        \`\`\`
      `),
      allowed: directiveAlwaysAllowed,
      providedBy: DirectiveProvidedBy.Marpit,
      type: DirectiveType.Local,
      details: 'https://marpit.marp.app/directives?id=header-and-footer',
    }),
    createDirectiveInfo({
      name: 'class',
      description:
        'Specify [HTML `class` attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/class) for the slide element `<section>`.',
      allowed: directiveAlwaysAllowed,
      providedBy: DirectiveProvidedBy.Marpit,
      type: DirectiveType.Local,
      details: 'https://marpit.marp.app/directives?id=class',
    }),
    createDirectiveInfo({
      name: 'backgroundColor',
      description:
        'Setting [`background-color` style](https://developer.mozilla.org/en-US/docs/Web/CSS/background-color) of the slide.',
      allowed: directiveAlwaysAllowed,
      providedBy: DirectiveProvidedBy.Marpit,
      type: DirectiveType.Local,
      details: 'https://marpit.marp.app/directives?id=backgrounds',
    }),
    createDirectiveInfo({
      name: 'backgroundImage',
      description:
        'Setting [`background-image` style](https://developer.mozilla.org/en-US/docs/Web/CSS/background-image) of the slide.',
      allowed: directiveAlwaysAllowed,
      providedBy: DirectiveProvidedBy.Marpit,
      type: DirectiveType.Local,
      details: 'https://marpit.marp.app/directives?id=backgrounds',
    }),
    createDirectiveInfo({
      name: 'backgroundPosition',
      description:
        'Setting [`background-position` style](https://developer.mozilla.org/en-US/docs/Web/CSS/background-position) of the slide.',
      allowed: directiveAlwaysAllowed,
      providedBy: DirectiveProvidedBy.Marpit,
      type: DirectiveType.Local,
      details: 'https://marpit.marp.app/directives?id=backgrounds',
    }),
    createDirectiveInfo({
      name: 'backgroundRepeat',
      description:
        'Setting [`background-repeat` style](https://developer.mozilla.org/en-US/docs/Web/CSS/background-repeat) of the slide.',
      allowed: directiveAlwaysAllowed,
      providedBy: DirectiveProvidedBy.Marpit,
      type: DirectiveType.Local,
      details: 'https://marpit.marp.app/directives?id=backgrounds',
    }),
    createDirectiveInfo({
      name: 'backgroundSize',
      description:
        'Setting [`background-size` style](https://developer.mozilla.org/en-US/docs/Web/CSS/background-size) of the slide.',
      allowed: directiveAlwaysAllowed,
      providedBy: DirectiveProvidedBy.Marpit,
      type: DirectiveType.Local,
      details: 'https://marpit.marp.app/directives?id=backgrounds',
    }),
    createDirectiveInfo({
      name: 'color',
      description:
        'Setting [`color` style](https://developer.mozilla.org/en-US/docs/Web/CSS/color) of the slide.',
      allowed: directiveAlwaysAllowed,
      providedBy: DirectiveProvidedBy.Marpit,
      type: DirectiveType.Local,
      details: 'https://marpit.marp.app/directives?id=backgrounds',
    }),

    // Marp Core extension
    createDirectiveInfo({
      name: 'size',
      description: dedent(`
        Choose the slide size preset provided by theme.

        Accepted presets are depending on using theme. In the case of Marp Core built-in theme, you can choose from \`16:9\` (1280x720) or \`4:3\` (960x720).
      `),
      allowed: directiveAlwaysAllowed,
      providedBy: DirectiveProvidedBy.MarpCore,
      type: DirectiveType.Global,
      details: 'https://github.com/marp-team/marp-core#size-global-directive',
    }),

    // Marp CLI metadata options
    createDirectiveInfo({
      name: 'title',
      description: 'Define title of the slide deck.',
      allowed: directiveAlwaysAllowed,
      providedBy: DirectiveProvidedBy.MarpCLI,
      type: DirectiveType.Global,
      details: 'https://github.com/marp-team/marp-cli#metadata',
    }),
    createDirectiveInfo({
      name: 'description',
      description: 'Define description of the slide deck.',
      allowed: directiveAlwaysAllowed,
      providedBy: DirectiveProvidedBy.MarpCLI,
      type: DirectiveType.Global,
      details: 'https://github.com/marp-team/marp-cli#metadata',
    }),
    createDirectiveInfo({
      name: 'url',
      description: 'Define canonical URL for the slide deck.',
      allowed: directiveAlwaysAllowed,
      providedBy: DirectiveProvidedBy.MarpCLI,
      type: DirectiveType.Global,
      details: 'https://github.com/marp-team/marp-cli#metadata',
    }),
    createDirectiveInfo({
      name: 'image',
      description: 'Define Open Graph image URL.',
      allowed: directiveAlwaysAllowed,
      providedBy: DirectiveProvidedBy.MarpCLI,
      type: DirectiveType.Global,
      details: 'https://github.com/marp-team/marp-cli#metadata',
    }),
  ]

  directives: DirectiveInfo[] = [...DirectiveParser.builtinDirectives]

  parse(doc: TextDocument) {
    this.emit('startParse', { document: doc })

    let markdown = doc.getText()
    let index = 0

    const detectDirectives = (
      text: string,
      offset: number,
      definedIn = DirectiveDefinedIn.Comment
    ) => {
      const { contents, errors } = parseYaml(text)

      if (errors.length === 0 && contents?.['items']) {
        for (const item of (contents as YAMLMap).items) {
          if (item.type === 'PAIR') {
            let scoped: boolean | undefined = undefined

            const directiveInfo = this.directives.find((d) => {
              if (!d.allowed.includes(definedIn)) return false

              if (item.key.value === d.name) return true

              if (
                d.type === DirectiveType.Local &&
                item.key.value === `_${d.name}`
              ) {
                scoped = true
                return true
              }

              return false
            })

            const info = directiveInfo
              ? createDirectiveInfo({ ...directiveInfo, scoped })
              : undefined

            this.emit('directive', { info, item, offset })
          }
        }
      }
    }

    // Front-matter
    const fmMatched = markdown.match(frontMatterRegex)

    if (fmMatched?.index === 0) {
      const [outerBody, open, body, close] = fmMatched
      index = open.length + body.length + close.length

      this.emit('frontMatter', {
        body: outerBody,
        range: new Range(doc.positionAt(0), doc.positionAt(index)),
      })

      detectDirectives(body, open.length, DirectiveDefinedIn.FrontMatter)

      markdown = markdown.slice(index)
    }

    // HTML comments
    visit(parseMd(markdown), 'html', (n: any) => {
      visit(parseHtml(n.value), 'comment', (c: any) => {
        this.emit('comment', {
          body: `<!--${c.value}-->`,
          range: new Range(
            doc.positionAt(index + n.position.start.offset - 4),
            doc.positionAt(index + n.position.end.offset + 3)
          ),
        })

        const trimmedLeft = c.value.replace(/^-*\s*/, '')

        detectDirectives(
          trimmedLeft.replace(/\s*-*$/, ''),
          index +
            n.position.start.offset +
            c.position.start.offset +
            4 +
            (c.value.length - trimmedLeft.length)
        )
      })
    })

    this.emit('endParse', { document: doc })
  }
}
