// Загрузка данных из JSON-файла
fetch('https://Rast-BeHappy.github.io/vegas-Team---Testers/reports.json')
    .then(response => response.json())
    .then(data => console.log(data));
