/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1231947254")

  // update field
  collection.fields.addAt(4, new Field({
    "help": "",
    "hidden": false,
    "id": "select3491738233",
    "maxSelect": 0,
    "name": "tipo",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "select",
    "values": [
      "PC",
      "Servidor",
      "NVR",
      "Otros"
    ]
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1231947254")

  // update field
  collection.fields.addAt(4, new Field({
    "help": "",
    "hidden": false,
    "id": "select3491738233",
    "maxSelect": 0,
    "name": "tipo",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "select",
    "values": [
      "PC",
      "Servidor",
      "NVR"
    ]
  }))

  return app.save(collection)
})
