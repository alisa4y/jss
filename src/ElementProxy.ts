import { Fn, XElement } from "./types"
import { isInteger, ox } from "flowco"

export function getLiftProxy(elm: XElement) {
  if (elm.dataset.item !== undefined) return createArrayEval(elm)
  return lift(elm)
}
function lift(elm: XElement, data = {}) {
  const { branch, key, item } = elm.dataset
  if (branch) {
    data = branch.split(".").reduce((o: any, k: string) => (o[k] = {}), data)
  }
  if (key) {
    if (key === "__uuid") {
      Object.defineProperty(data, "__uuid", {
        enumerable: false,
        configurable: false,
        get: () => elm.textContent,
        set: v => (elm.textContent = v),
      })
    } else if (item) {
      const arrayEval = createArrayEval(elm)
      definePropertyDescriptor(
        data,
        key,
        () => arrayEval,
        (v: any) => setHtmlElement(elm, v)
      )
    } else {
      const prop =
        (elm as unknown as HTMLInputElement).value === undefined
          ? "textContent"
          : "value"
      let getter
      if (elm.getAttribute("type") === "number")
        getter = () => parseInt((elm as any)[prop])
      else getter = () => (elm as any)[prop]
      definePropertyDescriptor(data, key, getter, (v: any) =>
        setHtmlElement(elm as any, v)
      )
    }
    return data
  }
  for (const child of elm.children) lift(child as XElement, data)
  return data
}
function definePropertyDescriptor(obj: object, key: string, get: Fn, set: Fn) {
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: false,
    get,
    set,
  })
}
function createSetter(elm: XElement, ds: DataSetter) {
  const { branch, key } = elm.dataset || {}
  let convertedCount = 0

  if (branch || key) {
    ds.mapData([branch, key].filter(k => k).join("."))
    convertedCount++
  }
  buildSetter(elm, ds)
  while (convertedCount-- > 0) ds.dataVars.pop()
}
function buildSetter(elm: XElement, ds: DataSetter) {
  const { key, item } = elm.dataset || {}
  if (key) {
    if (item) {
      ds.setArray(item, elm)
    } else ds.setContent(elm)
    ds.inChild.length > 0 && ds.usedDepth.push([...ds.childDepth])
  } else if (item) {
    ds.setArray(item, elm)
  } else
    for (let i = 0; i < elm.children.length; i++) {
      const child = elm.children[i]
      ds.inChild(i)
      createSetter(child as XElement, ds)
      ds.outChild()
    }
}
export class DataSetter {
  varId: number
  body: string
  elmArgs: Args
  dataVars: string[]
  usedDepth: number[][]
  childDepth: number[]
  constructor() {
    this.elmArgs = new Args()
    this.dataVars = ["data"]
    this.body = ""
    this.usedDepth = []
    this.childDepth = []
    this.varId = 0
  }
  genDataVar() {
    this.dataVars.push("_" + this.varId++)
  }
  mapData(branch: string) {
    this.genDataVar()
    const [dataVar, newDataVar] = this.dataVars.slice(-2)
    this.body += `let ${newDataVar}=${dataVar}.${branch}\n`
  }
  setContent(elm: XElement) {
    const prop =
      (elm as unknown as HTMLInputElement).value === undefined
        ? "textContent"
        : "value"
    const elmName = this.elmArgs.push(elm)
    this.body += `${elmName}.${prop}=${this.dataVars.at(-1)};\n`
  }
  setArray(item: string, elm: XElement) {
    const elmName = this.elmArgs.push(elm)
    const templateName = this.elmArgs.push(document.getElementById(item))
    const data = this.dataVars.at(-1)
    const wrapper =
      elm.tagName === "TBODY" ? "tr" : elm.dataset.wrapper || "div"
    this.body += `
    if(!Array.isArray(${data})) throw new Error(${data}+" is not an array");
  while(${elmName}.children.length > ${data}.length){${elmName}.removeChild(${elmName}.lastChild);}\n
  while(${elmName}.children.length < ${data}.length){
    const w = document.createElement("${wrapper}");
    const t = ${templateName}.content.cloneNode(true);
    const cl = t.children.length;
    for (let i = 0; i < cl; i++) w.appendChild(t.children[0]);
    w.__set = ${templateName}.__setter.bind(w);

    const uuid = document.createElement("div")
    uuid.setAttribute("style", "display: none")
    uuid.setAttribute("data-key", "__uuid")
    uuid.textContent = window.__uuid++
    w.appendChild(uuid)

    ${elmName}.appendChild(w);
  }\n
  {
    let {children} = ${elmName};
    for(let i=0;i < children.length;i++){
      children[i].eval = ${data}[i];
  }}\n`
  }
  inChild(i: number) {
    this.childDepth.push(i)
  }
  outChild() {
    this.childDepth.pop()
  }
}
export function buildDataSetter(elm: Element, ds = new DataSetter()) {
  buildSetter(elm as XElement, ds)
  if (!ds.body) return ox
  return new Function("data", ds.elmArgs.params.join(","), ds.body)
}
function genSetter(elm: XElement, ds = new DataSetter()) {
  buildSetter(elm, ds)
  if (!ds.body) return ox
  const setter = new Function("data", ds.elmArgs.params.join(","), ds.body)
  const args = [null, ...ds.elmArgs.args]
  return (d: any) => {
    args[0] = d
    setter.apply(null, args)
  }
}
class Args {
  args: any[]
  params: any[]
  constructor() {
    this.args = []
    this.params = []
  }
  push(arg: any) {
    this.args.push(arg)
    const varName = this.genVar()
    this.params.push(varName)
    return varName
  }
  genVar() {
    return "a" + Args.id++
  }
  static id = 0
}
export function setHtmlElement(elm: XElement, v: any, visitedElms = new Set()) {
  ;(elm.__set ?? (elm.__set = genSetter(elm)))(v)
}
const arProto = Array.prototype
const copyX = (o: XElement) => JSON.parse(JSON.stringify(o.eval))
function createArrayEval(elm: XElement) {
  const wrapper = elm.tagName === "TBODY" ? "tr" : elm.dataset.wrapper || "div"
  const template = document.getElementById(
    elm.dataset.item
  ) as HTMLTemplateElement
  return new Proxy([], {
    set(t, p, v) {
      if (isInteger(p as string)) {
        ;(elm.children[p as unknown as number] as unknown as XElement).eval = v
      }
      return true
    },
    get(t, p) {
      if (isInteger(p as string))
        return (elm.children[p as unknown as number] as unknown as XElement)
          .eval
      switch (p) {
        case "push":
          return (...v: any[]) => {
            v.forEach(value => {
              const item = createItem(template, wrapper)
              elm.appendChild(item)
              item.eval = value
            })
            return elm.children.length
          }
        case "pop":
          return () => {
            let { lastChild } = elm
            if (lastChild) {
              lastChild.remove()
              return copyX(lastChild as XElement)
            }
            return undefined
          }
        case "unshift":
          return (...v: any[]) => {
            v.forEach(value => {
              const item = createItem(template, wrapper)
              elm.insertBefore(item, elm.firstChild)
              item.eval = value
            })
            return elm.children.length
          }
        case "shift":
          return () => {
            let { firstChild } = elm
            if (firstChild) {
              firstChild.remove()
              return copyX(firstChild as XElement)
            }
            return undefined
          }
        case "splice":
          return (startIndex: number, deleteCount: number, ...v: any[]) => {
            const length = elm.children.length
            if (startIndex + deleteCount > length - 1)
              deleteCount = length - startIndex
            const newLength = length + v.length - deleteCount

            const deletedElms = []
            for (let i = startIndex; i < startIndex + deleteCount; i++)
              deletedElms.push(copyX(elm.children[i] as XElement))

            if (newLength < length) {
              const endDelete = startIndex + length - newLength
              for (let i = startIndex; i < endDelete; i++) {
                const child = elm.children[startIndex]
                child.remove()
              }
            } else if (newLength > length) {
              const newElmEnd = startIndex + newLength - length
              if (length > 0) {
                const startElm =
                  elm.children[startIndex] || (elm.lastChild as Element)
                for (let i = startIndex; i < newElmEnd; i++) {
                  const item = createItem(template, wrapper)
                  startElm.insertAdjacentElement("afterend", item)
                }
              } else {
                for (let i = startIndex; i < newElmEnd; i++)
                  elm.appendChild(createItem(template, wrapper))
              }
            }
            v.forEach((value, index) => {
              ;(elm.children[startIndex + index] as unknown as XElement).eval =
                value
            })
            return deletedElms
          }
        case "length":
          return elm.children.length
        default:
          return arProto[p as any].bind(
            [...elm.children].map((child: XElement) => child.eval)
          )
      }
    },
  })
}
;(window as any).__uuid = 0
function createItem(template: HTMLTemplateElement, wrapper: string) {
  const w = document.createElement(wrapper) as unknown as XElement
  const t = template.content.cloneNode(true) as HTMLElement
  const childrenLength = t.children.length
  for (let i = 0; i < childrenLength; i++) w.appendChild(t.children[0])
  w.appendChild(createUuidElement())
  w.__set = (template as any).__setter.bind(w)
  return w
}
export function createUuidElement() {
  const uuid = document.createElement("div")
  uuid.setAttribute("style", "display: none")
  uuid.setAttribute("data-key", "__uuid")
  uuid.textContent = ((window as any).__uuid++).toString()
  return uuid
}
