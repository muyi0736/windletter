import { lazy } from 'react'

/** KubeJS 工作台带 CodeMirror，体积大；打开工坊弹窗时才加载。 */
export const PackWorkshopModalLazy = lazy(() =>
  import('./PackWorkshopModal').then((module) => ({ default: module.PackWorkshopModal }))
)